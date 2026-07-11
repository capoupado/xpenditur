import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { currentLocalMonth } from '../utils/dates.js';

const router = express.Router();
router.use(requireAuth);

// Phase 1: simple current-month summary for the dashboard cards
// (total earnings, total spending, monthly net = "Balance").
// Richer stats endpoints (trends, per-category breakdown) arrive in Phase 2.
router.get('/summary', (req, res) => {
  const month = req.query.month && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : currentLocalMonth();

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

  res.json({
    month,
    totalEarnings: earnings,
    totalSpending: spending,
    balance: earnings - spending,
  });
});

export default router;
