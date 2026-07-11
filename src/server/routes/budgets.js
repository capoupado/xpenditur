import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { currentLocalMonth, isValidMonthString } from '../utils/dates.js';

const router = express.Router();
router.use(requireAuth);

// Budgets are spending limits only — no budgets on earning-only categories.
const BUDGETABLE_TYPES = ['spending', 'both'];

function validateBudgetInput(body, { partial = false } = {}) {
  const errors = [];

  if (!partial || body.amount !== undefined) {
    if (!Number.isInteger(body.amount) || body.amount <= 0) {
      errors.push('amount must be a positive integer number of cents');
    }
  }
  if (!partial || body.category_id !== undefined) {
    if (!Number.isInteger(body.category_id)) errors.push('category_id is required');
  }
  if (!partial || body.month !== undefined) {
    if (body.month !== null && body.month !== undefined && !isValidMonthString(body.month)) {
      errors.push('month must be null (default budget) or a valid YYYY-MM string');
    }
  }
  return errors;
}

function checkCategoryBudgetable(categoryId) {
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!category) return 'category_id does not reference an existing category';
  if (!BUDGETABLE_TYPES.includes(category.type)) {
    return `category "${category.name}" is of type "${category.type}" and cannot have a budget (budgets are spending limits only)`;
  }
  return null;
}

function friendlyUniqueError(err, month) {
  if (!err.message.includes('UNIQUE constraint failed')) return null;
  // Two distinct unique constraints can fire here, and SQLite's message only
  // names the columns, not the constraint: the (category_id, month) UNIQUE
  // fires for a duplicate month budget (message lists both columns), while
  // the partial index (one default per category) fires for a duplicate
  // default budget (message lists only category_id, since month IS NULL
  // rows aren't distinguished by SQLite's column-list message).
  if (err.message.includes('budgets.month')) {
    return `This category already has a budget for ${month}. Edit the existing one instead of creating another.`;
  }
  return 'This category already has a default budget. Edit the existing one instead of creating another.';
}

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
       FROM budgets b
       JOIN categories c ON c.id = b.category_id
       ORDER BY c.name ASC, b.month IS NULL DESC, b.month ASC`
    )
    .all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const errors = validateBudgetInput(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const { amount, category_id } = req.body;
  const month = req.body.month === undefined ? null : req.body.month;

  const categoryError = checkCategoryBudgetable(category_id);
  if (categoryError) return res.status(400).json({ error: categoryError });

  try {
    const info = db
      .prepare('INSERT INTO budgets (category_id, amount, month) VALUES (?, ?, ?)')
      .run(category_id, amount, month);
    const budget = db.prepare('SELECT * FROM budgets WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(budget);
  } catch (err) {
    const friendly = friendlyUniqueError(err, month);
    if (friendly) return res.status(400).json({ error: friendly });
    throw err;
  }
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM budgets WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Budget not found' });

  const errors = validateBudgetInput(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const amount = req.body.amount !== undefined ? req.body.amount : existing.amount;
  const category_id = req.body.category_id !== undefined ? req.body.category_id : existing.category_id;
  const month = req.body.month !== undefined ? req.body.month : existing.month;

  const categoryError = checkCategoryBudgetable(category_id);
  if (categoryError) return res.status(400).json({ error: categoryError });

  try {
    db.prepare('UPDATE budgets SET category_id = ?, amount = ?, month = ? WHERE id = ?').run(
      category_id,
      amount,
      month,
      id
    );
  } catch (err) {
    const friendly = friendlyUniqueError(err, month);
    if (friendly) return res.status(400).json({ error: friendly });
    throw err;
  }

  const updated = db.prepare('SELECT * FROM budgets WHERE id = ?').get(id);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM budgets WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Budget not found' });

  db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
  res.json({ ok: true });
});

// GET /api/budgets/status?month=YYYY-MM — for each category with an effective
// budget this month (month budget if present, else default), report spend,
// remaining, and percentage. Spend only ever counts 'spending' transactions,
// even for 'both' categories.
router.get('/status', (req, res) => {
  if (req.query.month !== undefined && !isValidMonthString(req.query.month)) {
    return res.status(400).json({ error: 'month must be a valid YYYY-MM string' });
  }
  const month = req.query.month && isValidMonthString(req.query.month) ? req.query.month : currentLocalMonth();

  const budgetRows = db
    .prepare(
      `SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
       FROM budgets b
       JOIN categories c ON c.id = b.category_id
       WHERE b.month = ? OR b.month IS NULL`
    )
    .all(month);

  // Resolve effective budget per category: month budget overrides default.
  const byCategory = new Map();
  for (const row of budgetRows) {
    const kind = row.month === month ? 'month' : 'default';
    const current = byCategory.get(row.category_id);
    // Month budget always wins over default if both present.
    if (!current || kind === 'month') {
      byCategory.set(row.category_id, { ...row, kind });
    }
  }

  const spendStmt = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE type = 'spending' AND category_id = ? AND strftime('%Y-%m', date) = ?`
  );

  const statuses = [];
  for (const budget of byCategory.values()) {
    const spend = spendStmt.get(budget.category_id, month).total;
    const remaining = budget.amount - spend;
    const percentage = budget.amount > 0 ? Math.round((spend / budget.amount) * 1000) / 10 : 0;
    statuses.push({
      category_id: budget.category_id,
      category_name: budget.category_name,
      category_icon: budget.category_icon,
      category_color: budget.category_color,
      budget_id: budget.id,
      kind: budget.kind,
      budget_amount: budget.amount,
      spend,
      remaining,
      percentage,
    });
  }

  statuses.sort((a, b) => b.percentage - a.percentage);

  res.json({ month, budgets: statuses });
});

export default router;
