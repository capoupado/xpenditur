// Phase 6 — Pending transactions (email-extraction candidates) endpoints.
//
// A pending_transactions row is NOT a ledger entry (CONTEXT.md → Pending
// Transaction). Its lifecycle is pending → approved | rejected; rows are never
// deleted — they are the extraction pipeline's audit log. Approval creates a
// real transaction, links it, and fires a budget-alert check via the Phase 5
// seam (checkBudgetAlertForTransaction).
//
// Approvability rules:
//   - Plain Approve always succeeds EXCEPT (a) non-EUR rows (quarantined — the
//     app never converts currency; the user must supply the real EUR amount via
//     Edit & Approve) and (b) future-dated rows (a pending date may be in the
//     future, but the resulting transaction must obey the no-future-date rule,
//     so plain approve is refused and the user must Edit & Approve with a valid
//     date).
//   - Edit & Approve runs full transaction validation on the supplied fields.

import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidDateString, isFutureDate } from '../utils/dates.js';
import { checkBudgetAlertForTransaction } from '../services/notifications.js';
import { pollAllInboxes } from '../services/imap.js';
import { getAiConfig, callAiChat } from '../services/ai-client.js';
import { buildCategoryHistory } from '../services/category-history.js';
import {
  parseExtractionResponse,
  resolveCategoryId,
  clampConfidence,
} from '../services/invoice-parser.js';

const router = express.Router();
router.use(requireAuth);

const VALID_TYPES = ['earning', 'spending'];
const VALID_STATUSES = ['pending', 'approved', 'rejected'];

// ---------------------------------------------------------------------------
// Helpers
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
function validateResolvedTransaction({ type, amount, category_id, date }) {
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
function commitApproval(pendingId, fields) {
  const run = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO transactions (type, amount, description, category_id, date) VALUES (?, ?, ?, ?, ?)')
      .run(fields.type, fields.amount, fields.description ?? null, fields.category_id, fields.date);
    const txnId = info.lastInsertRowid;
    db.prepare("UPDATE pending_transactions SET status = 'approved', transaction_id = ? WHERE id = ?").run(
      txnId,
      pendingId
    );
    return txnId;
  });
  const txnId = run();
  const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txnId);
  try {
    checkBudgetAlertForTransaction(transaction);
  } catch (err) {
    console.error('[pending] budget alert check failed (non-fatal):', err.message);
  }
  return transaction;
}

function getPending(id) {
  return db.prepare('SELECT * FROM pending_transactions WHERE id = ?').get(id);
}

// Surface confidence/vendor (stored only inside raw_extracted_json) alongside
// the row for the UI's confidence indicator.
function decorate(row) {
  let confidence = null;
  let vendor = null;
  if (row.raw_extracted_json) {
    try {
      const parsed = JSON.parse(row.raw_extracted_json);
      const c = Number(parsed.confidence);
      confidence = Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : null;
      vendor = typeof parsed.vendor === 'string' ? parsed.vendor : null;
    } catch {
      /* leave nulls */
    }
  }
  return { ...row, confidence, vendor };
}

// ---------------------------------------------------------------------------
// GET /api/pending?status=pending|approved|rejected|all
// ---------------------------------------------------------------------------

router.get('/', (req, res) => {
  const status = req.query.status || 'pending';
  if (status !== 'all' && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'invalid status filter' });
  }

  const where = status === 'all' ? '' : 'WHERE p.status = @status';
  const rows = db
    .prepare(
      `SELECT p.*, c.name AS suggested_category_name, c.icon AS suggested_category_icon,
              c.color AS suggested_category_color, a.label AS account_label
       FROM pending_transactions p
       JOIN categories c ON c.id = p.suggested_category_id
       LEFT JOIN imap_accounts a ON a.id = p.account_id
       ${where}
       ORDER BY p.created_at DESC, p.id DESC`
    )
    .all(status === 'all' ? {} : { status });

  res.json(rows.map(decorate));
});

// Small count endpoint for the nav badge.
router.get('/count', (req, res) => {
  const row = db.prepare("SELECT COUNT(*) AS c FROM pending_transactions WHERE status = 'pending'").get();
  res.json({ pending: row.c });
});

// ---------------------------------------------------------------------------
// POST /api/pending/:id/approve — plain approve
// ---------------------------------------------------------------------------

router.post('/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  const pending = getPending(id);
  if (!pending) return res.status(404).json({ error: 'Pending transaction not found' });
  if (pending.status !== 'pending') {
    return res.status(409).json({ error: `Cannot approve a row with status "${pending.status}"` });
  }
  if (pending.currency !== 'EUR') {
    return res.status(400).json({
      error: `This row is in ${pending.currency} and is quarantined. Use Edit & Approve to enter the real EUR amount — the app never converts currency.`,
    });
  }
  if (isFutureDate(pending.date)) {
    return res.status(400).json({
      error: 'This pending row is dated in the future. Use Edit & Approve to set a valid date (transactions cannot be future-dated).',
    });
  }

  const fields = {
    type: pending.type,
    amount: pending.amount,
    description: pending.description,
    category_id: pending.suggested_category_id,
    date: pending.date,
  };
  const err = validateResolvedTransaction(fields);
  if (err) return res.status(400).json({ error: err });

  const transaction = commitApproval(id, fields);
  res.status(201).json({ pending: decorate(getPending(id)), transaction });
});

// ---------------------------------------------------------------------------
// POST /api/pending/:id/approve-edited — override fields, then approve
// ---------------------------------------------------------------------------

router.post('/:id/approve-edited', (req, res) => {
  const id = Number(req.params.id);
  const pending = getPending(id);
  if (!pending) return res.status(404).json({ error: 'Pending transaction not found' });
  if (pending.status !== 'pending') {
    return res.status(409).json({ error: `Cannot approve a row with status "${pending.status}"` });
  }

  const body = req.body || {};
  const fields = {
    type: body.type !== undefined ? body.type : pending.type,
    amount: body.amount !== undefined ? body.amount : pending.amount,
    description: body.description !== undefined ? body.description : pending.description,
    category_id: body.category_id !== undefined ? body.category_id : pending.suggested_category_id,
    date: body.date !== undefined ? body.date : pending.date,
  };

  const err = validateResolvedTransaction(fields);
  if (err) return res.status(400).json({ error: err });

  // Non-EUR pending rows keep their original currency fields for audit; the
  // created transaction is always EUR cents (the amount the user supplied).
  const transaction = commitApproval(id, fields);
  res.status(201).json({ pending: decorate(getPending(id)), transaction });
});

// ---------------------------------------------------------------------------
// POST /api/pending/:id/reject — row retained, status = rejected
// ---------------------------------------------------------------------------

router.post('/:id/reject', (req, res) => {
  const id = Number(req.params.id);
  const pending = getPending(id);
  if (!pending) return res.status(404).json({ error: 'Pending transaction not found' });
  if (pending.status !== 'pending') {
    return res.status(409).json({ error: `Cannot reject a row with status "${pending.status}"` });
  }
  db.prepare("UPDATE pending_transactions SET status = 'rejected' WHERE id = ?").run(id);
  res.json({ pending: decorate(getPending(id)) });
});

// ---------------------------------------------------------------------------
// POST /api/pending/bulk — { action: 'approve'|'reject', ids: [...] }
// ---------------------------------------------------------------------------

router.post('/bulk', (req, res) => {
  const { action, ids } = req.body || {};
  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: "action must be 'approve' or 'reject'" });
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }

  const skipped = [];

  if (action === 'reject') {
    let rejected = 0;
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
      db.prepare("UPDATE pending_transactions SET status = 'rejected' WHERE id = ?").run(id);
      rejected++;
    }
    return res.json({ rejected, skipped });
  }

  // approve — skip quarantined (non-EUR) and future-dated rows, reporting them.
  let approved = 0;
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
    if (pending.currency !== 'EUR') {
      skipped.push({ id, reason: `quarantined (${pending.currency}) — use Edit & Approve` });
      continue;
    }
    if (isFutureDate(pending.date)) {
      skipped.push({ id, reason: 'future-dated — use Edit & Approve' });
      continue;
    }
    const fields = {
      type: pending.type,
      amount: pending.amount,
      description: pending.description,
      category_id: pending.suggested_category_id,
      date: pending.date,
    };
    const err = validateResolvedTransaction(fields);
    if (err) {
      skipped.push({ id, reason: err });
      continue;
    }
    commitApproval(id, fields);
    approved++;
  }
  res.json({ approved, skipped });
});

// ---------------------------------------------------------------------------
// POST /api/pending/categorize — { ids: [...] }
//
// Re-categorizes pending rows. Mainly useful for statement/file imports, which
// all land as "Other". Rows whose description the user has categorized before
// reuse that category from the ledger (services/category-history.js); only
// the rest go to the configured AI provider. Updates suggested_category_id
// and stores the confidence + source in raw_extracted_json (so the UI's
// confidence dot reflects the categorization). Rows stay pending — the user
// still approves.
// ---------------------------------------------------------------------------

const CATEGORIZE_BATCH_SIZE = 40;

function buildCategorizationPrompt(categoryNames) {
  const list = (categoryNames && categoryNames.length ? categoryNames : ['Other']).join(', ');
  return `You are a financial transaction categorizer. You will receive a JSON array of transactions.
For each, pick the single best matching category from: [${list}].
Respond ONLY with a JSON object, no other text:
{"assignments": [{"id": number — the transaction's id, "category": "string — exactly one of the listed category names", "confidence": number — 0 to 1}]}`;
}

router.post('/categorize', async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }

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
    let raw = {};
    if (row.raw_extracted_json) {
      try {
        raw = JSON.parse(row.raw_extracted_json);
      } catch {
        /* start fresh */
      }
    }
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
    if (fromHistory === 0) return res.json({ noop: true });
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
      saveSuggestion(row, categoryId, { name: a.category, confidence: a.confidence, source: 'ai' });
    }
  }

  res.json({ categorized, fromHistory, skipped });
});

// ---------------------------------------------------------------------------
// POST /api/pending/poll-now — manual IMAP poll trigger
// ---------------------------------------------------------------------------

router.post('/poll-now', async (req, res) => {
  try {
    const counts = await pollAllInboxes();
    res.json(counts);
  } catch (err) {
    // pollAllInboxes is designed never to throw, but stay defensive.
    console.error('[pending] poll-now failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/pending/poll-range — manual backfill poll over an explicit
// fromDate..toDate window (inclusive). Never runs on a schedule and never
// advances the incremental last_poll cursor; processed_emails dedup makes
// re-polling an already-covered window harmless.
// ---------------------------------------------------------------------------

router.post('/poll-range', async (req, res) => {
  const { fromDate, toDate } = req.body || {};
  if (!isValidDateString(fromDate) || !isValidDateString(toDate)) {
    return res.status(400).json({ error: 'fromDate and toDate must be valid YYYY-MM-DD dates' });
  }
  if (fromDate > toDate) {
    return res.status(400).json({ error: 'fromDate must not be after toDate' });
  }
  try {
    const counts = await pollAllInboxes({ fromDate, toDate });
    res.json(counts);
  } catch (err) {
    console.error('[pending] poll-range failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
