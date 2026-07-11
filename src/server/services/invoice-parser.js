// Phase 6 — DeepSeek API integration for invoice/email parsing.
//
// The mailbox poller (services/imap.js) hands us an email's plain-text body;
// this module asks DeepSeek to extract a structured transaction, applies the
// spec's gap-filling defaults so every produced row is "approvable by
// construction", and inserts a `pending_transactions` row.
//
// Design: the network call is isolated in `callDeepSeek`; everything around it
// (prompt building, response parsing, gap-filling, category resolution, cents
// conversion) is a set of pure functions so they can be unit-tested against a
// mock server / synthetic responses without touching a real DeepSeek endpoint.
//
// Test-only deviation: the base URL is read from DEEPSEEK_BASE_URL (default
// https://api.deepseek.com) so verification can point it at a local mock HTTP
// server. Production leaves it unset and hits the real API.

import db from '../db.js';
import { getSetting } from './settings-store.js';
import { isValidDateString } from '../utils/dates.js';

const DEEPSEEK_MODEL = 'deepseek-chat';

function baseUrl() {
  const raw = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  return raw.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Prompt (verbatim from plan.md, with the user's category names injected)
// ---------------------------------------------------------------------------

export function buildSystemPrompt(categoryNames) {
  const list = (categoryNames && categoryNames.length ? categoryNames : ['Other']).join(', ');
  return `You are a financial document parser. Extract transaction details from the following email.
Respond ONLY with a JSON object, no other text:
{
  "vendor": "string — who was paid or who sent the invoice",
  "type": "spending | earning — was this money the user paid out, or money they received (refund, payout)? If unsure, use spending",
  "amount": number — total amount (use the final/total amount),
  "currency": "string — ISO 4217 code of the amount as stated in the email, e.g. EUR, USD",
  "date": "YYYY-MM-DD — transaction or invoice date",
  "description": "string — brief description of what was purchased/paid",
  "category_suggestion": "string — best matching category from: [${list}]",
  "confidence": number — 0 to 1, how confident you are in the extraction
}
If you cannot extract meaningful transaction data, return: {"error": "Could not parse invoice"}`;
}

// ---------------------------------------------------------------------------
// Response parsing (defensive: strip code fences, tolerate surrounding text)
// ---------------------------------------------------------------------------

export function stripCodeFences(text) {
  if (typeof text !== 'string') return '';
  let t = text.trim();
  // ```json ... ``` or ``` ... ```
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  return t;
}

// Extracts the first balanced {...} JSON object from arbitrary text.
function firstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse DeepSeek's assistant content into an object. Tolerates code fences and
 * surrounding prose. Throws if no JSON object can be recovered.
 */
export function parseExtractionResponse(content) {
  const cleaned = stripCodeFences(content);
  try {
    return JSON.parse(cleaned);
  } catch {
    const candidate = firstJsonObject(cleaned);
    if (candidate) {
      return JSON.parse(candidate); // may still throw → caller treats as unparseable
    }
    throw new Error('No JSON object found in DeepSeek response');
  }
}

// ---------------------------------------------------------------------------
// Gap-filling → a complete pending row
// ---------------------------------------------------------------------------

export function toCents(amount) {
  const n = typeof amount === 'string' ? Number(amount.replace(/[^0-9.\-]/g, '')) : Number(amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Resolve a category-name suggestion to a category id, case-insensitively,
 * additionally requiring the category's type to be compatible with `type`
 * (a `both` category matches anything). Falls back to the "Other" system
 * category when there is no compatible match — this is what makes every
 * produced pending row approvable by construction (its category always
 * matches its type).
 */
export function resolveCategoryId(name, type, categories, otherId) {
  if (typeof name === 'string' && name.trim()) {
    const target = name.trim().toLowerCase();
    const match = categories.find((c) => c.name.toLowerCase() === target);
    if (match && (match.type === 'both' || match.type === type)) return match.id;
  }
  return otherId;
}

/**
 * Turn a parsed extraction object into the concrete pending_transactions row
 * fields, applying every gap-filling default from the spec. Returns null when
 * the extraction lacks a usable amount (nothing meaningful to approve).
 *
 * @returns {null | { type, amount, currency, description, suggested_category_id, date, confidence, vendor }}
 */
export function buildPendingRow(extracted, { categories, otherId, emailReceivedDate }) {
  if (!extracted || typeof extracted !== 'object' || extracted.error) return null;

  const cents = toCents(extracted.amount);
  if (cents === null || cents <= 0) return null; // no usable amount → skip

  // type: spending | earning, default spending
  const type = extracted.type === 'earning' ? 'earning' : 'spending';

  // currency: uppercased ISO-ish code, default EUR
  let currency = 'EUR';
  if (typeof extracted.currency === 'string' && /^[a-z]{3}$/i.test(extracted.currency.trim())) {
    currency = extracted.currency.trim().toUpperCase();
  }

  // date: valid YYYY-MM-DD, else the email's received date
  const date =
    typeof extracted.date === 'string' && isValidDateString(extracted.date)
      ? extracted.date
      : emailReceivedDate;

  const suggested_category_id = resolveCategoryId(extracted.category_suggestion, type, categories, otherId);

  const description =
    (typeof extracted.description === 'string' && extracted.description.trim()) ||
    (typeof extracted.vendor === 'string' && extracted.vendor.trim()) ||
    null;

  return {
    type,
    amount: cents,
    currency,
    description,
    suggested_category_id,
    date,
    confidence: clampConfidence(extracted.confidence),
    vendor: typeof extracted.vendor === 'string' ? extracted.vendor : null,
  };
}

// ---------------------------------------------------------------------------
// Network call
// ---------------------------------------------------------------------------

/**
 * Calls DeepSeek's OpenAI-compatible chat completions endpoint and returns the
 * raw assistant message content (a string). Throws on transport/HTTP errors.
 */
export async function callDeepSeek({ bodyText, categoryNames, apiKey }) {
  const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: buildSystemPrompt(categoryNames) },
        { role: 'user', content: bodyText },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DeepSeek responded ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('DeepSeek response had no message content');
  }
  return content;
}

// ---------------------------------------------------------------------------
// Orchestration — extract + insert a pending row
// ---------------------------------------------------------------------------

function loadCategories() {
  return db.prepare('SELECT id, name, type, is_system FROM categories').all();
}

function otherCategoryId(categories) {
  const other = categories.find((c) => c.is_system === 1) || categories.find((c) => c.name === 'Other');
  return other ? other.id : categories[0]?.id;
}

/**
 * Extract a pending transaction from one email and insert it into
 * pending_transactions. The caller (imap.js) is responsible for recording the
 * email in processed_emails FIRST (so the email is deduped whether or not
 * extraction succeeds).
 *
 * Never throws — returns a small result object describing the outcome:
 *   { inserted: true, pendingId, row }             extraction succeeded
 *   { inserted: false, reason: 'no-api-key' }       DeepSeek not configured
 *   { inserted: false, reason: 'api-error', error } transport/HTTP failure
 *   { inserted: false, reason: 'unparseable' }      response wasn't usable JSON
 *   { inserted: false, reason: 'model-error' }      model returned {"error":...}
 *   { inserted: false, reason: 'no-amount' }         no usable amount extracted
 */
export async function extractAndInsertPending(email) {
  const apiKey = getSetting('deepseek_api_key');
  if (!apiKey) return { inserted: false, reason: 'no-api-key' };

  const categories = loadCategories();
  const otherId = otherCategoryId(categories);
  const categoryNames = categories.map((c) => c.name);

  let content;
  try {
    content = await callDeepSeek({
      bodyText: email.bodyText,
      categoryNames,
      apiKey,
    });
  } catch (err) {
    console.error('[invoice-parser] DeepSeek call failed (non-fatal):', err.message);
    return { inserted: false, reason: 'api-error', error: err.message };
  }

  let extracted;
  try {
    extracted = parseExtractionResponse(content);
  } catch (err) {
    console.error('[invoice-parser] Could not parse DeepSeek response (non-fatal):', err.message);
    return { inserted: false, reason: 'unparseable' };
  }

  if (extracted && extracted.error) {
    console.log('[invoice-parser] Model reported it could not parse the invoice; skipping row.');
    return { inserted: false, reason: 'model-error' };
  }

  const row = buildPendingRow(extracted, {
    categories,
    otherId,
    emailReceivedDate: email.receivedDate,
  });
  if (!row) {
    return { inserted: false, reason: 'no-amount' };
  }

  // Store the full parsed extraction (plus the original raw content) for
  // debugging and so the UI can surface confidence/vendor.
  const rawStored = JSON.stringify({ ...extracted, _rawContent: content });

  const info = db
    .prepare(
      `INSERT INTO pending_transactions
         (type, amount, currency, description, suggested_category_id, date,
          source_email_subject, source_email_from, source_email_date, raw_extracted_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(
      row.type,
      row.amount,
      row.currency,
      row.description,
      row.suggested_category_id,
      row.date,
      email.subject || null,
      email.from || null,
      email.receivedAt || null,
      rawStored
    );

  return { inserted: true, pendingId: info.lastInsertRowid, row };
}

export default {
  buildSystemPrompt,
  stripCodeFences,
  parseExtractionResponse,
  toCents,
  clampConfidence,
  resolveCategoryId,
  buildPendingRow,
  callDeepSeek,
  extractAndInsertPending,
};
