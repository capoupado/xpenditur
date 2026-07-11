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
import { pollInbox } from '../services/imap.js';

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
              c.color AS suggested_category_color
       FROM pending_transactions p
       JOIN categories c ON c.id = p.suggested_category_id
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
// POST /api/pending/poll-now — manual IMAP poll trigger
// ---------------------------------------------------------------------------

router.post('/poll-now', async (req, res) => {
  try {
    const counts = await pollInbox();
    res.json(counts);
  } catch (err) {
    // pollInbox is designed never to throw, but stay defensive.
    console.error('[pending] poll-now failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
