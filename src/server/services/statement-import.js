// Bank statement file import (CSV / PDF) → pending_transactions.
//
// Imported rows enter the SAME review pipeline as bank sync: nothing
// touches the ledger until the user approves it on the Pending page. CSV is
// parsed deterministically (no AI): the parser auto-detects the delimiter and
// header row and understands the Portuguese export conventions used by CGD and
// Novo Banco (DD-MM-YYYY dates, comma decimals, separate Débito/Crédito
// columns) as well as generic single-amount-column layouts. PDF statements
// have no stable machine-readable structure, so their extracted text is handed
// to the configured AI provider with a batch prompt.
//
// Dedup: each row gets a stable key (date|type|amount|description + an
// occurrence counter so N identical same-day rows import as N rows) recorded
// in import_dedup under source id 0 — re-importing
// the same or an overlapping export is harmless.

import crypto from 'crypto';
import db from '../db.js';
import { isValidDateString } from '../utils/dates.js';
import { isProcessed, recordProcessed } from './import-dedup.js';
import { parseExtractionResponse, toCents } from './ai-response.js';
import { getAiConfig, callAiChat } from './ai-client.js';

// import_dedup source id for file imports (bank sync uses -1).
export const IMPORT_SOURCE = 0;

const MAX_PDF_TEXT_CHARS = 50000;

function importError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ---------------------------------------------------------------------------
// Text decoding — Portuguese bank CSV exports are frequently Windows-1252, not
// UTF-8. If a UTF-8 decode produced replacement characters, fall back.
// ---------------------------------------------------------------------------

export function decodeTextBuffer(buf) {
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('�')) return utf8;
  return buf.toString('latin1');
}

// ---------------------------------------------------------------------------
// CSV parsing primitives (pure, unit-testable)
// ---------------------------------------------------------------------------

// "Descrição " → "descricao" (lowercase, accents stripped, trimmed, no trailing dot)
export function normalizeHeaderCell(cell) {
  return String(cell || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\.+$/, '');
}

export function detectDelimiter(line) {
  const candidates = [';', '\t', ','];
  let best = ';';
  let bestCount = 0;
  for (const d of candidates) {
    const count = line.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

// Split one CSV line on `delim`, honouring double-quoted cells ("" escapes a quote).
export function parseCsvLine(line, delim) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * Parse an amount string into signed integer cents. Handles Portuguese
 * ("1.234,56", "-12,30") and Anglo ("1,234.56") formats, currency symbols,
 * and parenthesised negatives. Returns null when unparseable.
 */
export function parseAmountToCents(raw) {
  let s = String(raw ?? '')
    .replace(/eur/gi, '')
    .replace(/[€$\s ]/g, '')
    .trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  // The last . or , is the decimal separator iff it has 1-2 trailing digits;
  // otherwise it's a thousands separator ("1.234" → 1234).
  const sep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  let intPart = s;
  let frac = '';
  if (sep !== -1) {
    const after = s.slice(sep + 1);
    if (after.length >= 1 && after.length <= 2 && /^\d+$/.test(after)) {
      intPart = s.slice(0, sep);
      frac = after;
    }
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (intPart === '') intPart = '0';
  if (!/^\d+$/.test(intPart)) return null;
  const cents = Number(intPart) * 100 + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/**
 * Parse a date cell into YYYY-MM-DD. Accepts YYYY-MM-DD, DD-MM-YYYY,
 * DD/MM/YYYY and DD.MM.YYYY (day-first, the Portuguese convention).
 * Returns null when unparseable.
 */
export function parseDateFlexible(raw) {
  const s = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isValidDateString(s) ? s : null;
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isValidDateString(iso) ? iso : null;
}

// Header-name synonyms (normalized form), in priority order.
const HEADER_MATCHERS = {
  date: ['data mov', 'data do movimento', 'data operacao', 'data lancamento', 'data', 'date', 'booking date'],
  description: ['descricao', 'descritivo', 'description', 'movimento', 'detalhe', 'observacoes'],
  debit: ['debito', 'debit', 'valor a debito'],
  credit: ['credito', 'credit', 'valor a credito'],
  amount: ['montante', 'importancia', 'valor', 'amount', 'value'],
};

function matchColumns(cells) {
  const normalized = cells.map(normalizeHeaderCell);
  const cols = {};
  for (const [field, names] of Object.entries(HEADER_MATCHERS)) {
    for (const name of names) {
      const idx = normalized.findIndex(
        (c) => c === name || (name.length > 4 && c.startsWith(name))
      );
      if (idx !== -1) {
        cols[field] = idx;
        break;
      }
    }
  }
  return cols;
}

/**
 * Find the header row within the first lines of a statement CSV (bank exports
 * usually prepend account metadata). A row qualifies when it has a date column
 * and either a single amount column or debit/credit columns.
 * Returns { headerIndex, delimiter, cols } or null.
 */
export function findHeader(lines) {
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const delimiter = detectDelimiter(line);
    const cells = parseCsvLine(line, delimiter);
    if (cells.length < 2) continue;
    const cols = matchColumns(cells);
    if (cols.date === undefined) continue;
    if (cols.amount !== undefined || cols.debit !== undefined || cols.credit !== undefined) {
      return { headerIndex: i, delimiter, cols };
    }
  }
  return null;
}

/**
 * Parse a full CSV statement into normalized rows. Rows whose date doesn't
 * parse (footers like CGD's "Saldo contabilístico") or that carry no usable
 * amount are counted in `skippedRows`, not errors.
 *
 * @returns { rows: [{ date, description, cents }], skippedRows }
 *          cents is SIGNED: negative = money out (debit), positive = money in.
 */
export function parseCsvStatement(text) {
  const lines = String(text || '').split(/\r\n|\r|\n/);
  const header = findHeader(lines);
  if (!header) {
    throw importError(
      'Could not find a header row in the CSV. Expected columns like Data / Descrição plus Débito/Crédito or Montante (CGD and Novo Banco exports work as-is).'
    );
  }

  const { headerIndex, delimiter, cols } = header;
  const rows = [];
  let skippedRows = 0;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = parseCsvLine(lines[i], delimiter);
    const date = parseDateFlexible(cells[cols.date]);
    if (!date) {
      skippedRows++;
      continue;
    }

    let cents = null;
    if (cols.debit !== undefined || cols.credit !== undefined) {
      const debit = cols.debit !== undefined ? parseAmountToCents(cells[cols.debit]) : null;
      const credit = cols.credit !== undefined ? parseAmountToCents(cells[cols.credit]) : null;
      // Debit columns are typically unsigned; force money-out negative.
      if (debit) cents = -Math.abs(debit);
      else if (credit) cents = Math.abs(credit);
    } else {
      cents = parseAmountToCents(cells[cols.amount]);
    }
    if (!cents) {
      skippedRows++;
      continue;
    }

    const description = cols.description !== undefined ? cells[cols.description] || null : null;
    rows.push({ date, description, cents });
  }

  return { rows, skippedRows };
}

// ---------------------------------------------------------------------------
// PDF → text → AI batch extraction
// ---------------------------------------------------------------------------

const PDF_SYSTEM_PROMPT = `You are a bank statement parser. Extract EVERY transaction from the bank statement text the user provides. Statements are typically from Portuguese banks (CGD, Novo Banco): dates may appear as DD-MM-YYYY or DD/MM/YYYY and amounts use comma decimals (1.234,56).
Respond ONLY with a JSON object, no other text:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "string — the movement description as printed",
      "amount": number — positive amount of the movement,
      "type": "spending | earning — spending for debits/money out, earning for credits/money in"
    }
  ]
}
Skip balance lines, carried-forward totals, page headers/footers and anything that is not an actual movement. If no transactions can be extracted, return {"transactions": []}.`;

async function extractPdfText(buffer) {
  // Lazy import so CSV import and unit tests never need the dependency loaded.
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return (result.text || '').trim();
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function parsePdfStatement(buffer) {
  const ai = getAiConfig();
  if (!ai) {
    throw importError('PDF import needs an AI provider (Settings → AI provider) — PDFs are parsed by AI. CSV import works without it.');
  }

  let text;
  try {
    text = await extractPdfText(buffer);
  } catch (err) {
    throw importError(`Could not read the PDF: ${err.message}`);
  }
  if (!text) throw importError('The PDF contains no extractable text (it may be a scanned image).');
  if (text.length > MAX_PDF_TEXT_CHARS) text = text.slice(0, MAX_PDF_TEXT_CHARS);

  let content;
  try {
    content = await callAiChat(ai, { systemPrompt: PDF_SYSTEM_PROMPT, userContent: text });
  } catch (err) {
    throw importError(`${ai.label} call failed: ${err.message}`);
  }

  let extracted;
  try {
    extracted = parseExtractionResponse(content);
  } catch {
    throw importError(`${ai.label} returned an unparseable response for this PDF.`);
  }

  const list = Array.isArray(extracted?.transactions) ? extracted.transactions : [];
  const rows = [];
  let skippedRows = 0;
  for (const t of list) {
    const date = parseDateFlexible(t?.date);
    const cents = toCents(t?.amount);
    if (!date || !cents || cents <= 0) {
      skippedRows++;
      continue;
    }
    rows.push({
      date,
      description: typeof t.description === 'string' && t.description.trim() ? t.description.trim() : null,
      cents: t.type === 'earning' ? cents : -cents,
    });
  }
  return { rows, skippedRows };
}

// ---------------------------------------------------------------------------
// Insertion into pending_transactions (shared by CSV and PDF paths)
// ---------------------------------------------------------------------------

// Shared with the bank sync (enablebanking.js): externally-sourced pending
// rows always default to the "Other" system category.
export function otherCategoryId() {
  const categories = db.prepare('SELECT id, name, is_system FROM categories').all();
  const other = categories.find((c) => c.is_system === 1) || categories.find((c) => c.name === 'Other');
  const id = other ? other.id : categories[0]?.id;
  if (!id) throw importError('No categories exist to attach imported rows to.', 500);
  return id;
}

/**
 * Insert normalized rows ({ date, description, cents } — signed cents) as
 * pending_transactions, deduplicating via import_dedup under
 * IMPORT_SOURCE. Identical rows WITHIN one file get distinct occurrence
 * numbers (so two identical coffees on the same day both import), and because
 * occurrences are assigned in file order the same rows in an overlapping
 * export dedup correctly.
 */
export function insertImportedRows(rows, filename) {
  const categoryId = otherCategoryId();
  const insert = db.prepare(
    `INSERT INTO pending_transactions
       (type, amount, currency, description, suggested_category_id, date,
        source_label, source_kind, raw_extracted_json, status)
     VALUES (?, ?, 'EUR', ?, ?, ?, ?, 'file-import', ?, 'pending')`
  );

  const occurrences = new Map();
  let inserted = 0;
  let skippedDuplicates = 0;

  const runAll = db.transaction(() => {
    for (const row of rows) {
      const type = row.cents < 0 ? 'spending' : 'earning';
      const amount = Math.abs(row.cents);
      const key = `${row.date}|${type}|${amount}|${(row.description || '').toLowerCase()}`;
      const occ = (occurrences.get(key) || 0) + 1;
      occurrences.set(key, occ);
      const dedupId = 'import:' + crypto.createHash('sha256').update(`${key}|${occ}`).digest('hex');

      if (isProcessed(IMPORT_SOURCE, dedupId)) {
        skippedDuplicates++;
        continue;
      }
      recordProcessed(IMPORT_SOURCE, dedupId);
      insert.run(
        type,
        amount,
        row.description,
        categoryId,
        row.date,
        `Import: ${filename}`,
        JSON.stringify({ source: 'file-import', filename, ...row })
      );
      inserted++;
    }
  });
  runAll();

  return { inserted, skippedDuplicates };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Import one uploaded statement file. `buffer` is the raw file bytes.
 * Throws errors with a `.status` for the route to relay.
 *
 * @returns { source: 'csv'|'pdf', parsed, inserted, skippedDuplicates, skippedRows }
 */
export async function importStatementFile({ filename, buffer }) {
  const ext = String(filename || '').toLowerCase().split('.').pop();

  let parsed;
  let source;
  if (ext === 'csv' || ext === 'txt') {
    source = 'csv';
    parsed = parseCsvStatement(decodeTextBuffer(buffer));
  } else if (ext === 'pdf') {
    source = 'pdf';
    parsed = await parsePdfStatement(buffer);
  } else {
    throw importError('Unsupported file type — upload a .csv or .pdf bank statement export.');
  }

  const { inserted, skippedDuplicates } = insertImportedRows(parsed.rows, filename);
  return {
    source,
    parsed: parsed.rows.length,
    inserted,
    skippedDuplicates,
    skippedRows: parsed.skippedRows,
  };
}

export default {
  IMPORT_SOURCE,
  decodeTextBuffer,
  normalizeHeaderCell,
  detectDelimiter,
  parseCsvLine,
  parseAmountToCents,
  parseDateFlexible,
  findHeader,
  parseCsvStatement,
  insertImportedRows,
  importStatementFile,
};
