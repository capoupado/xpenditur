// Ruling on Pending Transactions: approval, categorization, and the automatic
// pass that runs on freshly synced/imported rows.
//
// Shared by routes/pending.js (the user's clicks) and the intake paths (bank
// sync, statement import) that run `reviewNewPending` on the rows they just
// inserted. See CONTEXT.md → Pending Transaction for the lifecycle.

import db from '../db.js';
import { isValidDateString, isFutureDate } from '../utils/dates.js';
import { checkBudgetAlertForTransaction, checkUnusualSpending, sendAutoApprovedSummary } from './notifications.js';
import { getAiConfig, callAiChat } from './ai-client.js';
import { buildCategoryHistory } from './category-history.js';
import { getSetting, getSettingNumber } from './settings-store.js';
import { parseExtractionResponse, resolveCategoryId, clampConfidence } from './ai-response.js';

const VALID_TYPES = ['earning', 'spending'];

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

function checkCategoryTypeMatch(categoryId, type) {
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!category) return 'category_id does not reference an existing category';
  if (category.type !== 'both' && category.type !== type) {
    return `category "${category.name}" is of type "${category.type}" and cannot be used for a "${type}" transaction`;
  }
  return null;
}

// Validate a fully-resolved set of transaction fields (as a transaction create
// would). Returns an error string or null.
export function validateResolvedTransaction({ type, amount, category_id, date }) {
  if (!VALID_TYPES.includes(type)) return `type must be one of ${VALID_TYPES.join(', ')}`;
  if (!Number.isInteger(amount) || amount <= 0) return 'amount must be a positive integer number of cents';
  if (!Number.isInteger(category_id)) return 'category_id is required';
  if (!isValidDateString(date)) return 'date must be a valid YYYY-MM-DD date';
  if (isFutureDate(date)) return 'date cannot be in the future';
  return checkCategoryTypeMatch(category_id, type);
}

// Create the real transaction from resolved fields and mark the pending row
// approved + linked, atomically. Returns the created transaction row. Fires the
// budget-alert check AFTER the write commits (the row already exists).
// `rawPatch` is merged into raw_extracted_json (e.g. { auto_approved: true }).
export function commitApproval(pendingId, fields, rawPatch = null) {
  const run = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO transactions (type, amount, description, category_id, date) VALUES (?, ?, ?, ?, ?)')
      .run(fields.type, fields.amount, fields.description ?? null, fields.category_id, fields.date);
    const txnId = info.lastInsertRowid;
    db.prepare("UPDATE pending_transactions SET status = 'approved', transaction_id = ? WHERE id = ?").run(
      txnId,
      pendingId
    );
    if (rawPatch) {
      const raw = { ...parseRaw(getPending(pendingId)), ...rawPatch };
      db.prepare('UPDATE pending_transactions SET raw_extracted_json = ? WHERE id = ?').run(JSON.stringify(raw), pendingId);
    }
    return txnId;
  });
  const txnId = run();
  const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txnId);
  try {
    checkBudgetAlertForTransaction(transaction);
  } catch (err) {
    console.error('[pending] budget alert check failed (non-fatal):', err.message);
  }
  checkUnusualSpending(transaction);
  return transaction;
}

export function getPending(id) {
  return db.prepare('SELECT * FROM pending_transactions WHERE id = ?').get(id);
}

function parseRaw(row) {
  if (!row?.raw_extracted_json) return {};
  try {
    return JSON.parse(row.raw_extracted_json) || {};
  } catch {
    return {};
  }
}

// Surface confidence/vendor (stored only inside raw_extracted_json) alongside
// the row for the UI's confidence indicator.
export function decorate(row) {
  const parsed = parseRaw(row);
  const c = Number(parsed.confidence);
  return {
    ...row,
    confidence: parsed.confidence != null && Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : null,
    vendor: typeof parsed.vendor === 'string' ? parsed.vendor : null,
    category_source: typeof parsed.category_source === 'string' ? parsed.category_source : null,
    auto_approved: parsed.auto_approved === true,
  };
}

// Why a pending row can't be plain-approved, or null if it can.
export function plainApproveBlocker(pending) {
  if (pending.currency !== 'EUR') return `quarantined (${pending.currency}) — use Edit & Approve`;
  if (isFutureDate(pending.date)) return 'future-dated — use Edit & Approve';
  return null;
}

export function plainApprovalFields(pending) {
  return {
    type: pending.type,
    amount: pending.amount,
    description: pending.description,
    category_id: pending.suggested_category_id,
    date: pending.date,
  };
}

// ---------------------------------------------------------------------------
// Categorization
//
// Rows whose description the user has categorized before reuse that category
// from the ledger (services/category-history.js); only the rest go to the
// configured AI provider. Updates suggested_category_id and stores the
// confidence + source in raw_extracted_json. Rows stay pending.
// ---------------------------------------------------------------------------

const CATEGORIZE_BATCH_SIZE = 40;

function buildCategorizationPrompt(categoryNames) {
  const list = (categoryNames && categoryNames.length ? categoryNames : ['Other']).join(', ');
  return `You are a financial transaction categorizer. You will receive a JSON array of transactions.
For each, pick the single best matching category from: [${list}].
Respond ONLY with a JSON object, no other text:
{"assignments": [{"id": number — the transaction's id, "category": "string — exactly one of the listed category names", "confidence": number — 0 to 1}]}`;
}

/**
 * Categorize pending rows by id. Returns { categorized, fromHistory, skipped }
 * or { noop: true } when nothing could be done (no history hit, no AI).
 */
export async function categorizePending(ids) {
  const ai = getAiConfig();

  const categories = db.prepare('SELECT id, name, type, is_system FROM categories').all();
  const categoryNames = categories.map((c) => c.name);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const otherId = (categories.find((c) => c.is_system === 1) || categories.find((c) => c.name === 'Other'))?.id;

  const skipped = [];
  const candidates = [];
  for (const rawId of ids) {
    const id = Number(rawId);
    const pending = getPending(id);
    if (!pending) {
      skipped.push({ id, reason: 'not found' });
      continue;
    }
    if (pending.status !== 'pending') {
      skipped.push({ id, reason: `already ${pending.status}` });
      continue;
    }
    candidates.push(decorate(pending));
  }

  let categorized = 0;
  let fromHistory = 0;
  const update = db.prepare(
    "UPDATE pending_transactions SET suggested_category_id = ?, raw_extracted_json = ? WHERE id = ? AND status = 'pending'"
  );
  const saveSuggestion = (row, categoryId, { name, confidence, source }) => {
    const raw = parseRaw(row);
    raw.category_suggestion = name;
    raw.category_source = source;
    raw.confidence = clampConfidence(confidence);
    update.run(categoryId, JSON.stringify(raw), row.id);
    categorized++;
  };

  // 1. Ledger history — free, deterministic, and knows the user's context.
  const history = buildCategoryHistory({ ignoreCategoryIds: otherId ? [otherId] : [] });
  const rows = [];
  for (const row of candidates) {
    const hit = history.suggest(row.description, row.type) || history.suggest(row.vendor, row.type);
    const category = hit && categoryById.get(hit.categoryId);
    if (category) {
      saveSuggestion(row, category.id, { name: category.name, confidence: hit.confidence, source: 'history' });
      fromHistory++;
    } else {
      rows.push(row);
    }
  }

  // 2. AI for descriptions never seen before.
  if (!ai) {
    if (fromHistory === 0) return { noop: true };
    rows.forEach((r) => skipped.push({ id: r.id, reason: 'no match in history and no AI provider configured' }));
    rows.length = 0;
  }

  for (let i = 0; i < rows.length; i += CATEGORIZE_BATCH_SIZE) {
    const batch = rows.slice(i, i + CATEGORIZE_BATCH_SIZE);
    const userContent = JSON.stringify(
      batch.map((r) => ({
        id: r.id,
        description: r.description,
        vendor: r.vendor,
        type: r.type,
        amount: `${(r.amount / 100).toFixed(2)} ${r.currency}`,
        date: r.date,
      }))
    );

    let assignments;
    try {
      const content = await callAiChat(ai, {
        systemPrompt: buildCategorizationPrompt(categoryNames),
        userContent,
      });
      const parsed = parseExtractionResponse(content);
      assignments = Array.isArray(parsed?.assignments) ? parsed.assignments : [];
    } catch (err) {
      console.error('[pending] categorize batch failed (non-fatal):', err.message);
      batch.forEach((r) => skipped.push({ id: r.id, reason: `${ai.label} error: ${err.message.slice(0, 120)}` }));
      continue;
    }

    const byId = new Map(assignments.map((a) => [Number(a.id), a]));
    for (const row of batch) {
      const a = byId.get(row.id);
      if (!a || typeof a.category !== 'string') {
        skipped.push({ id: row.id, reason: 'model returned no assignment' });
        continue;
      }
      const categoryId = resolveCategoryId(a.category, row.type, categories, otherId);
      // A made-up or type-incompatible name falls back to Other — that's a
      // guess, not a match, so it must never be auto-approved.
      const fellBack =
        categoryId === otherId && a.category.trim().toLowerCase() !== categoryById.get(otherId)?.name.toLowerCase();
      const confidence = fellBack ? 0 : a.confidence;
      saveSuggestion(row, categoryId, { name: a.category, confidence, source: 'ai' });
    }
  }

  return { categorized, fromHistory, skipped };
}

// ---------------------------------------------------------------------------
// Automatic review (Settings → Automation)
// ---------------------------------------------------------------------------

export function automationSettings() {
  return {
    autoCategorize: getSetting('auto_categorize') === '1',
    autoApprove: getSetting('auto_approve') === '1',
    minConfidence: getSettingNumber('auto_approve_min_confidence', 80) / 100,
  };
}

/**
 * Approve every pending row (of `ids`, or all pending rows when omitted)
 * whose category suggestion is at least `minConfidence` sure. Rows that
 * can't be plain-approved (foreign currency, future date) or were never
 * categorized are left for the user. Returns { approved: [transaction], left }.
 */
export function autoApprovePending({ ids = null, minConfidence = automationSettings().minConfidence } = {}) {
  const rows = ids
    ? ids.map((id) => getPending(Number(id))).filter(Boolean)
    : db.prepare("SELECT * FROM pending_transactions WHERE status = 'pending' ORDER BY date ASC, id ASC").all();

  const approved = [];
  let left = 0;
  for (const pending of rows) {
    if (pending.status !== 'pending') continue;
    const { confidence } = decorate(pending);
    if (confidence == null || confidence < minConfidence || plainApproveBlocker(pending)) {
      left++;
      continue;
    }
    const fields = plainApprovalFields(pending);
    if (validateResolvedTransaction(fields)) {
      left++;
      continue;
    }
    const transaction = commitApproval(pending.id, fields, { auto_approved: true });
    approved.push({ ...transaction, confidence });
  }
  return { approved, left };
}

/**
 * The automatic pass over rows an intake (bank sync, statement import) just
 * inserted: categorize them, then approve the confident ones, per the
 * Automation settings. Never throws — intake must not fail because the AI
 * provider is down. Returns { categorized, autoApproved, left }.
 */
export async function reviewNewPending(ids) {
  const result = { categorized: 0, autoApproved: 0, left: ids.length };
  if (ids.length === 0) return result;
  const settings = automationSettings();
  try {
    if (settings.autoCategorize) {
      const c = await categorizePending(ids);
      result.categorized = c.categorized || 0;
    }
    if (settings.autoApprove) {
      const a = autoApprovePending({ ids, minConfidence: settings.minConfidence });
      result.autoApproved = a.approved.length;
      result.left = a.left;
      if (a.approved.length > 0) sendAutoApprovedSummary(a.approved, a.left);
    }
  } catch (err) {
    console.error('[pending] automatic review failed (non-fatal):', err.message);
  }
  return result;
}
