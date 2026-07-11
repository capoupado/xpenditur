import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { currentLocalMonth, isValidMonthString, shiftMonth, allDatesInMonth } from '../utils/dates.js';

const router = express.Router();
router.use(requireAuth);

function resolveMonth(req) {
  return req.query.month && isValidMonthString(req.query.month) ? req.query.month : currentLocalMonth();
}

function monthlyTotals(month) {
  const rows = db
    .prepare(
      `SELECT type, COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE strftime('%Y-%m', date) = ?
       GROUP BY type`
    )
    .all(month);

  let earnings = 0;
  let spending = 0;
  for (const row of rows) {
    if (row.type === 'earning') earnings = row.total;
    if (row.type === 'spending') spending = row.total;
  }
  return { totalEarnings: earnings, totalSpending: spending, balance: earnings - spending };
}

// Phase 2: aggregated stats for a single month, including a daily spending
// series (every day of the month present, zero-filled) for the trend chart.
// Kept `/summary` as a backward-compatible alias for the Phase 1 dashboard cards.
function monthlyHandler(req, res) {
  if (req.query.month !== undefined && !isValidMonthString(req.query.month)) {
    return res.status(400).json({ error: 'month must be a valid YYYY-MM string' });
  }
  const month = resolveMonth(req);
  const totals = monthlyTotals(month);

  const dailyRows = db
    .prepare(
      `SELECT date, COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE type = 'spending' AND strftime('%Y-%m', date) = ?
       GROUP BY date`
    )
    .all(month);
  const dailyMap = new Map(dailyRows.map((r) => [r.date, r.total]));
  const dailySpending = allDatesInMonth(month).map((date) => ({ date, total: dailyMap.get(date) || 0 }));

  res.json({ month, ...totals, dailySpending });
}

router.get('/monthly', monthlyHandler);
router.get('/summary', monthlyHandler);

// GET /api/stats/trends?months=6 — multi-month earnings/spending/balance trend,
// oldest to newest, always including the current month.
router.get('/trends', (req, res) => {
  const rawMonths = parseInt(req.query.months, 10);
  const count = Number.isInteger(rawMonths) ? Math.min(24, Math.max(1, rawMonths)) : 6;

  const current = currentLocalMonth();
  const months = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = shiftMonth(current, -i);
    months.push({ month, ...monthlyTotals(month) });
  }

  res.json({ months });
});

// GET /api/stats/categories?month=YYYY-MM — per-category breakdown, split by
// transaction type (a `both`-type category can hold both earnings and
// spendings, so we aggregate by the transaction's own type, not the category's).
router.get('/categories', (req, res) => {
  if (req.query.month !== undefined && !isValidMonthString(req.query.month)) {
    return res.status(400).json({ error: 'month must be a valid YYYY-MM string' });
  }
  const month = resolveMonth(req);

  const rows = db
    .prepare(
      `SELECT c.id AS category_id, c.name AS category_name, c.icon AS category_icon,
              c.color AS category_color, t.type AS type, COALESCE(SUM(t.amount), 0) AS total
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE strftime('%Y-%m', t.date) = ?
       GROUP BY c.id, t.type
       ORDER BY total DESC`
    )
    .all(month);

  const totals = monthlyTotals(month);

  res.json({
    month,
    categories: rows,
    totalEarnings: totals.totalEarnings,
    totalSpending: totals.totalSpending,
  });
});

export default router;
