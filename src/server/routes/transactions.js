import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidDateString, isFutureDate } from '../utils/dates.js';
import { withBudgetAlertCheck, checkUnusualSpending } from '../services/notifications.js';

const router = express.Router();
router.use(requireAuth);

const VALID_TYPES = ['earning', 'spending'];

function validateTransactionInput(body, { partial = false } = {}) {
  const errors = [];

  if (!partial || body.type !== undefined) {
    if (!VALID_TYPES.includes(body.type)) errors.push(`type must be one of ${VALID_TYPES.join(', ')}`);
  }
  if (!partial || body.amount !== undefined) {
    if (!Number.isInteger(body.amount) || body.amount <= 0) {
      errors.push('amount must be a positive integer number of cents');
    }
  }
  if (!partial || body.category_id !== undefined) {
    if (!Number.isInteger(body.category_id)) errors.push('category_id is required');
  }
  if (!partial || body.date !== undefined) {
    if (!isValidDateString(body.date)) {
      errors.push('date must be a valid YYYY-MM-DD date');
    } else if (isFutureDate(body.date)) {
      errors.push('date cannot be in the future');
    }
  }
  return errors;
}

function checkCategoryTypeMatch(categoryId, type) {
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!category) return 'category_id does not reference an existing category';
  if (category.type !== 'both' && category.type !== type) {
    return `category "${category.name}" is of type "${category.type}" and cannot be used for a "${type}" transaction`;
  }
  return null;
}

router.get('/', (req, res) => {
  const { type, category_id, date_from, date_to, page = 1, page_size = 50 } = req.query;

  const clauses = [];
  const params = {};

  if (type) {
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'invalid type filter' });
    clauses.push('t.type = @type');
    params.type = type;
  }
  if (category_id) {
    clauses.push('t.category_id = @category_id');
    params.category_id = Number(category_id);
  }
  if (date_from) {
    if (!isValidDateString(date_from)) return res.status(400).json({ error: 'invalid date_from' });
    clauses.push('t.date >= @date_from');
    params.date_from = date_from;
  }
  if (date_to) {
    if (!isValidDateString(date_to)) return res.status(400).json({ error: 'invalid date_to' });
    clauses.push('t.date <= @date_to');
    params.date_to = date_to;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSizeNum = Math.min(200, Math.max(1, parseInt(page_size, 10) || 50));
  const offset = (pageNum - 1) * pageSizeNum;

  const total = db.prepare(`SELECT COUNT(*) AS c FROM transactions t ${where}`).get(params).c;

  const rows = db
    .prepare(
      `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       ${where}
       ORDER BY t.date DESC, t.id DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: pageSizeNum, offset });

  res.json({
    data: rows,
    pagination: {
      page: pageNum,
      pageSize: pageSizeNum,
      total,
      totalPages: Math.ceil(total / pageSizeNum) || 1,
    },
  });
});

router.post('/', (req, res) => {
  const errors = validateTransactionInput(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const { type, amount, description = null, category_id, date } = req.body;

  const typeError = checkCategoryTypeMatch(category_id, type);
  if (typeError) return res.status(400).json({ error: typeError });

  const month = date.slice(0, 7);
  const info = withBudgetAlertCheck(category_id, month, type, () =>
    db
      .prepare(
        'INSERT INTO transactions (type, amount, description, category_id, date) VALUES (?, ?, ?, ?, ?)'
      )
      .run(type, amount, description, category_id, date)
  );

  const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
  checkUnusualSpending(transaction);
  res.status(201).json(transaction);
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });

  const errors = validateTransactionInput(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const type = req.body.type !== undefined ? req.body.type : existing.type;
  const amount = req.body.amount !== undefined ? req.body.amount : existing.amount;
  const description = req.body.description !== undefined ? req.body.description : existing.description;
  const category_id = req.body.category_id !== undefined ? req.body.category_id : existing.category_id;
  const date = req.body.date !== undefined ? req.body.date : existing.date;

  const typeError = checkCategoryTypeMatch(category_id, type);
  if (typeError) return res.status(400).json({ error: typeError });

  // Budget alerts evaluate the category+month the transaction LANDS IN (the
  // new state) — before/after are captured around the write itself, so an
  // edit that moves category/month is handled correctly (see
  // services/notifications.js → withBudgetAlertCheck).
  const month = date.slice(0, 7);
  withBudgetAlertCheck(category_id, month, type, () =>
    db
      .prepare(
        'UPDATE transactions SET type = ?, amount = ?, description = ?, category_id = ?, date = ? WHERE id = ?'
      )
      .run(type, amount, description, category_id, date, id)
  );

  const updated = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });

  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
