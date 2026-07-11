// Phase 5 — Discord webhook notifications.
//
// Every public "send" function is fire-and-forget: it kicks off a fetch POST
// and returns immediately. Failures (network error, missing/invalid webhook,
// non-2xx response) are caught and logged — NEVER thrown into a request
// handler, and never allowed to block or fail the transaction write that
// triggered them. `sendTestNotification` is the one exception: the Settings
// UI needs a real pass/fail result, so it awaits the fetch and returns it.
//
// If no webhook is configured, every send silently no-ops (checked before any
// fetch is attempted).

import db from '../db.js';
import { getSetting, getSettingNumber } from './settings-store.js';
import { getEffectiveBudget, getCategorySpend } from './budget-lookup.js';
import * as __dates from '../utils/dates.js';

const { currentLocalMonth } = __dates;

const COLOR_GREEN = 0x2ecc71; // earnings / healthy
const COLOR_RED = 0xe74c3c; // overspend / 100%+ budget alerts
const COLOR_ORANGE = 0xe67e22; // 80% budget warning
const COLOR_BLUE = 0x3498db; // summaries / neutral info

function centsToEuro(cents) {
  return `€${(Math.round(cents) / 100).toFixed(2)}`;
}

function nowFooter() {
  return { text: 'xPenditur', timestamp: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Low-level webhook transport
// ---------------------------------------------------------------------------

async function postToDiscord(payload) {
  const webhookUrl = getSetting('discord_webhook_url');
  if (!webhookUrl) return { skipped: true };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord webhook responded ${res.status}${text ? `: ${text}` : ''}`);
  }
  return { skipped: false, status: res.status };
}

// Fires the send and swallows/logs any failure. Never returns a rejected
// promise, never throws synchronously.
function fireAndForget(buildAndSend, label) {
  Promise.resolve()
    .then(buildAndSend)
    .catch((err) => {
      console.error(`[notifications] ${label} failed (non-fatal):`, err.message);
    });
}

// ---------------------------------------------------------------------------
// Embed builders
// ---------------------------------------------------------------------------

function budgetAlertEmbed(category, spent, limit, percentage, thresholdPct) {
  const color = thresholdPct >= 100 ? COLOR_RED : COLOR_ORANGE;
  return {
    title: `${thresholdPct >= 100 ? '🚨' : '⚠️'} Budget alert — ${category.icon || ''} ${category.name}`.trim(),
    description: `Spending just crossed **${thresholdPct}%** of this month's budget.`,
    color,
    fields: [
      { name: 'Spent', value: centsToEuro(spent), inline: true },
      { name: 'Budget', value: centsToEuro(limit), inline: true },
      { name: 'Percentage', value: `${percentage.toFixed(1)}%`, inline: true },
    ],
    footer: nowFooter(),
  };
}

function recurringReminderEmbed(transaction) {
  const isEarning = transaction.type === 'earning';
  return {
    title: `${isEarning ? '💰' : '🔁'} Recurring transaction auto-created`,
    color: isEarning ? COLOR_GREEN : COLOR_RED,
    fields: [
      { name: 'Description', value: transaction.description || '(none)', inline: false },
      { name: 'Amount', value: `${isEarning ? '+' : '-'}${centsToEuro(transaction.amount)}`, inline: true },
      { name: 'Category', value: transaction.category_name || String(transaction.category_id), inline: true },
      { name: 'Date', value: transaction.date, inline: true },
    ],
    footer: nowFooter(),
  };
}

function weeklySummaryEmbed({ totalSpent, topCategories, budgetStatuses, from, to }) {
  return {
    title: '📅 Weekly summary',
    description: `Spending from ${from} to ${to}`,
    color: COLOR_BLUE,
    fields: [
      { name: 'Total spent (last 7 days)', value: centsToEuro(totalSpent), inline: false },
      {
        name: 'Top categories',
        value:
          topCategories.length === 0
            ? 'No spending recorded'
            : topCategories
                .map((c, i) => `${i + 1}. ${c.icon || ''} ${c.name} — ${centsToEuro(c.total)}`.trim())
                .join('\n'),
        inline: false,
      },
      {
        name: 'Budget status (this month)',
        value:
          budgetStatuses.length === 0
            ? 'No budgets set'
            : budgetStatuses
                .map((b) => `${b.icon || ''} ${b.name} — ${b.percentage.toFixed(0)}% (${centsToEuro(b.spend)}/${centsToEuro(b.amount)})`.trim())
                .join('\n'),
        inline: false,
      },
    ],
    footer: nowFooter(),
  };
}

function monthlySummaryEmbed({ month, earnings, spending, net, budgetPerformance }) {
  return {
    title: `🗓️ Monthly recap — ${month}`,
    color: COLOR_BLUE,
    fields: [
      { name: 'Earnings', value: centsToEuro(earnings), inline: true },
      { name: 'Spending', value: centsToEuro(spending), inline: true },
      { name: 'Net', value: `${net >= 0 ? '+' : ''}${centsToEuro(net)}`, inline: true },
      {
        name: 'Budget performance',
        value:
          budgetPerformance.length === 0
            ? 'No budgets set'
            : budgetPerformance
                .map((b) => {
                  const verdict = b.spend > b.amount ? 'over' : 'under';
                  return `${b.icon || ''} ${b.name} — ${centsToEuro(b.spend)}/${centsToEuro(b.amount)} (${verdict})`.trim();
                })
                .join('\n'),
        inline: false,
      },
    ],
    footer: nowFooter(),
  };
}

function testEmbed() {
  return {
    title: '✅ xPenditur test notification',
    description: 'If you can see this, your Discord webhook is configured correctly.',
    color: COLOR_GREEN,
    footer: nowFooter(),
  };
}

// ---------------------------------------------------------------------------
// Public send functions (fire-and-forget)
// ---------------------------------------------------------------------------

// sendBudgetAlert(category, spent, limit, percentage) per plan.md's
// NotificationService signature. `thresholdPct` (80 or 100) says which
// threshold this particular alert is for, driving the embed's urgency color.
export function sendBudgetAlert(category, spent, limit, percentage, thresholdPct) {
  fireAndForget(
    () => postToDiscord({ embeds: [budgetAlertEmbed(category, spent, limit, percentage, thresholdPct)] }),
    'sendBudgetAlert'
  );
}

export function sendRecurringReminder(transaction) {
  fireAndForget(() => postToDiscord({ embeds: [recurringReminderEmbed(transaction)] }), 'sendRecurringReminder');
}

function computeWeeklySummaryData() {
  const today = __dates.todayLocalDate();
  const from = __dates.addDays(today, -6);

  const totalSpent = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
       WHERE type = 'spending' AND date >= ? AND date <= ?`
    )
    .get(from, today).total;

  const topCategories = db
    .prepare(
      `SELECT c.name AS name, c.icon AS icon, COALESCE(SUM(t.amount), 0) AS total
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.type = 'spending' AND t.date >= ? AND t.date <= ?
       GROUP BY c.id ORDER BY total DESC LIMIT 3`
    )
    .all(from, today);

  const month = currentLocalMonth();
  const budgetStatuses = currentMonthBudgetStatuses(month);

  return { totalSpent, topCategories, budgetStatuses, from, to: today };
}

function currentMonthBudgetStatuses(month) {
  const budgetRows = db
    .prepare(
      `SELECT b.*, c.name AS name, c.icon AS icon
       FROM budgets b JOIN categories c ON c.id = b.category_id
       WHERE b.month = ? OR b.month IS NULL`
    )
    .all(month);

  const byCategory = new Map();
  for (const row of budgetRows) {
    const kind = row.month === month ? 'month' : 'default';
    const current = byCategory.get(row.category_id);
    if (!current || kind === 'month') byCategory.set(row.category_id, { ...row, kind });
  }

  const statuses = [];
  for (const budget of byCategory.values()) {
    const spend = getCategorySpend(budget.category_id, month);
    const percentage = budget.amount > 0 ? (spend / budget.amount) * 100 : 0;
    statuses.push({ name: budget.name, icon: budget.icon, amount: budget.amount, spend, percentage });
  }
  statuses.sort((a, b) => b.percentage - a.percentage);
  return statuses;
}

export function sendWeeklySummary() {
  fireAndForget(async () => {
    const data = computeWeeklySummaryData();
    return postToDiscord({ embeds: [weeklySummaryEmbed(data)] });
  }, 'sendWeeklySummary');
}

function computeMonthlySummaryData() {
  const month = __dates.shiftMonth(currentLocalMonth(), -1);

  const totalsRows = db
    .prepare(`SELECT type, COALESCE(SUM(amount), 0) AS total FROM transactions WHERE strftime('%Y-%m', date) = ? GROUP BY type`)
    .all(month);
  let earnings = 0;
  let spending = 0;
  for (const row of totalsRows) {
    if (row.type === 'earning') earnings = row.total;
    if (row.type === 'spending') spending = row.total;
  }

  const budgetPerformance = currentMonthBudgetStatuses(month).map((b) => ({
    name: b.name,
    icon: b.icon,
    amount: b.amount,
    spend: b.spend,
  }));

  return { month, earnings, spending, net: earnings - spending, budgetPerformance };
}

export function sendMonthlySummary() {
  fireAndForget(async () => {
    const data = computeMonthlySummaryData();
    return postToDiscord({ embeds: [monthlySummaryEmbed(data)] });
  }, 'sendMonthlySummary');
}

// Awaited (not fire-and-forget) — the Settings UI's test button needs a real
// success/failure result back from Discord.
export async function sendTestNotification() {
  const webhookUrl = getSetting('discord_webhook_url');
  if (!webhookUrl) {
    return { success: false, error: 'No Discord webhook configured' };
  }
  try {
    const result = await postToDiscord({ embeds: [testEmbed()] });
    if (result.skipped) return { success: false, error: 'No Discord webhook configured' };
    return { success: true, status: result.status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Budget-threshold-crossing evaluation
// ---------------------------------------------------------------------------

// Fires sendBudgetAlert for every threshold (configured lower threshold,
// default 80, plus a fixed 100) that spend crossed from below to
// at-or-above, comparing spend-before vs spend-after. Stateless: no
// alert-state table, so dropping back below and crossing again re-fires.
function evaluateAndFireBudgetAlerts({ categoryId, month, spendBefore, spendAfter }) {
  const budget = getEffectiveBudget(categoryId, month);
  if (!budget || !(budget.amount > 0)) return; // no effective budget => never alert

  const category = db.prepare('SELECT id, name, icon, color FROM categories WHERE id = ?').get(categoryId);
  if (!category) return;

  const lowerThreshold = getSettingNumber('notification_budget_threshold', 80);
  const thresholds = [...new Set([lowerThreshold, 100])].sort((a, b) => a - b);

  for (const pct of thresholds) {
    const thresholdAmount = (budget.amount * pct) / 100;
    if (spendBefore < thresholdAmount && spendAfter >= thresholdAmount) {
      const percentage = (spendAfter / budget.amount) * 100;
      sendBudgetAlert(category, spendAfter, budget.amount, percentage, pct);
    }
  }
}

/**
 * Wraps a transaction write (insert or update) that hasn't happened yet.
 * Captures the category+month's spend immediately before `writeFn()` runs
 * and immediately after, then evaluates threshold crossings on that
 * before/after pair. Use this from route handlers, where the write is a
 * `db.prepare(...).run(...)` call under our control.
 *
 * Only 'spending' transactions can trigger an alert (earnings never fire) —
 * for any other type this just runs `writeFn()` untouched.
 */
export function withBudgetAlertCheck(categoryId, month, type, writeFn) {
  if (type !== 'spending') return writeFn();

  const spendBefore = getCategorySpend(categoryId, month);
  const result = writeFn();
  const spendAfter = getCategorySpend(categoryId, month);

  try {
    evaluateAndFireBudgetAlerts({ categoryId, month, spendBefore, spendAfter });
  } catch (err) {
    console.error('[notifications] budget alert evaluation failed (non-fatal):', err);
  }

  return result;
}

/**
 * Evaluates a budget-threshold crossing for a transaction that has ALREADY
 * been committed to the DB (e.g. a just-materialised recurring transaction,
 * or — in a future phase — a just-approved pending transaction). Since the
 * row already exists, "spend before" is computed by excluding its own id
 * (equivalent to "before it was created"), and "spend after" is the actual
 * current sum. This is exact for freshly-created rows; it is NOT used for
 * updates to a pre-existing row (routes/transactions.js uses
 * `withBudgetAlertCheck` for that, since it wraps the write itself).
 */
export function checkBudgetAlertForTransaction(transaction) {
  if (!transaction || transaction.type !== 'spending') return;
  const month = String(transaction.date).slice(0, 7);
  const spendBefore = getCategorySpend(transaction.category_id, month, transaction.id);
  const spendAfter = getCategorySpend(transaction.category_id, month);

  try {
    evaluateAndFireBudgetAlerts({ categoryId: transaction.category_id, month, spendBefore, spendAfter });
  } catch (err) {
    console.error('[notifications] budget alert evaluation failed (non-fatal):', err);
  }
}

// ---------------------------------------------------------------------------
// Phase 4 → Phase 5 seam
// ---------------------------------------------------------------------------

// Called once per auto-created transaction, AFTER the recurring engine's
// per-template DB transaction has committed (services/recurring.js). Sends
// the "auto-created" reminder embed and runs the budget-alert check for it.
export function onRecurringMaterialised(transaction) {
  const categoryRow = db
    .prepare('SELECT name AS category_name FROM categories WHERE id = ?')
    .get(transaction.category_id);
  sendRecurringReminder({ ...transaction, category_name: categoryRow?.category_name });
  checkBudgetAlertForTransaction(transaction);
}

export default {
  sendBudgetAlert,
  sendRecurringReminder,
  sendWeeklySummary,
  sendMonthlySummary,
  sendTestNotification,
  withBudgetAlertCheck,
  checkBudgetAlertForTransaction,
  onRecurringMaterialised,
};
