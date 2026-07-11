// Shared "effective budget" resolution + spend lookup for a single category+month.
//
// This is the same precedence rule routes/budgets.js applies in bulk for
// GET /api/budgets/status (month budget overrides default; else default;
// else no budget) — factored out here so services/notifications.js can reuse
// it for budget-alert threshold checks instead of reimplementing the rule.

import db from '../db.js';

/**
 * Returns the effective budget row for one category+month, or null if the
 * category has neither a month budget for `month` nor a default budget.
 * Month budget (month = the given month) always wins over the default
 * (month IS NULL) — they never add.
 */
export function getEffectiveBudget(categoryId, month) {
  const monthBudget = db
    .prepare('SELECT * FROM budgets WHERE category_id = ? AND month = ?')
    .get(categoryId, month);
  if (monthBudget) return { ...monthBudget, kind: 'month' };

  const defaultBudget = db
    .prepare('SELECT * FROM budgets WHERE category_id = ? AND month IS NULL')
    .get(categoryId);
  if (defaultBudget) return { ...defaultBudget, kind: 'default' };

  return null;
}

/**
 * Sum of 'spending' transactions for a category in a given YYYY-MM month.
 * Budgets are spending-only (a `both` category's budget ignores its
 * earnings), matching routes/budgets.js's status query.
 *
 * `excludeTransactionId`, when given, omits that transaction's row from the
 * sum — used to compute "spend before" a transaction that already exists in
 * the DB (e.g. a freshly materialised recurring transaction), by treating it
 * as not-yet-created.
 */
export function getCategorySpend(categoryId, month, excludeTransactionId = null) {
  const row = excludeTransactionId
    ? db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total
           FROM transactions
           WHERE type = 'spending' AND category_id = ? AND strftime('%Y-%m', date) = ? AND id != ?`
        )
        .get(categoryId, month, excludeTransactionId)
    : db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total
           FROM transactions
           WHERE type = 'spending' AND category_id = ? AND strftime('%Y-%m', date) = ?`
        )
        .get(categoryId, month);
  return row.total;
}

export default { getEffectiveBudget, getCategorySpend };
