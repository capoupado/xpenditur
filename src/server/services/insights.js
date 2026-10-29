// Insights computed from the ledger: regular-payment detection ("subscription
// radar"), the current month's month-end forecast, and unusual-spending checks.
//
// Everything here reads the ledger and recurring templates only — Pending rows
// are not facts yet (CONTEXT.md → Pending Transaction) and are ignored.
//
// Regular payments are grouped by the same normalized description the
// category-history matcher uses (case/accents folded, tokens with digits
// dropped), so "NETFLIX.COM 12/09" and "NETFLIX.COM 12/10" are one series.

import db from '../db.js';
import { normalizeDescription } from './category-history.js';
import { advanceDueDate } from './recurring.js';
import { getEffectiveBudget } from './budget-lookup.js';
import { todayLocalDate, currentLocalMonth, shiftMonth, daysInMonthCount, addDays, daysBetween } from '../utils/dates.js';

const DETECTION_LOOKBACK_DAYS = 400;
const VARIABLE_RATE_MONTHS = 3;

// Cadences a series can settle on; `min`/`max` bound the median interval and
// every individual gap (a bank booking a monthly charge 3 days late is still
// monthly). Yearly accepts two occurrences, the rest need three.
const CADENCES = [
  { id: 'weekly', days: 7, min: 5, max: 9, minCount: 3 },
  { id: 'monthly', days: 30.44, min: 25, max: 36, minCount: 3 },
  { id: 'quarterly', days: 91.3, min: 80, max: 100, minCount: 3 },
  { id: 'yearly', days: 365.25, min: 340, max: 390, minCount: 2 },
];

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(n) {
  return Math.round(n);
}

// ---------------------------------------------------------------------------
// Regular payment detection
// ---------------------------------------------------------------------------

/**
 * Classify one series of same-description transactions (sorted by date).
 * Returns null when the series isn't regular. Pure — exported for tests.
 */
export function classifySeries(txns, today) {
  const dates = txns.map((t) => t.date);
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  // Same-day duplicates (two coffees) say nothing about cadence.
  const realGaps = gaps.filter((g) => g > 0);
  if (realGaps.length === 0) return null;

  const medianGap = median(realGaps);
  const cadence = CADENCES.find((c) => medianGap >= c.min && medianGap <= c.max);
  if (!cadence || txns.length < cadence.minCount) return null;
  // Most gaps must fit the cadence too, so a burst of purchases plus one big
  // gap doesn't pass for "monthly".
  const fitting = realGaps.filter((g) => g >= cadence.min && g <= cadence.max).length;
  if (fitting / realGaps.length < 0.75) return null;

  const amounts = txns.map((t) => t.amount);
  const last = txns[txns.length - 1];
  const samePrice = (a, b) => Math.abs(a - b) < Math.max(50, b * 0.02);

  // Price change: the latest run of same-price charges, preceded by a run at
  // another price. Spread is measured within each run, so a fixed-price
  // subscription that went up once still counts as fixed-price.
  let runStart = txns.length - 1;
  while (runStart > 0 && samePrice(txns[runStart - 1].amount, last.amount)) runStart--;
  const current = amounts.slice(runStart);
  const before = amounts.slice(0, runStart);
  const spreadOf = (xs) => {
    if (xs.length < 2) return 0;
    const mean = xs.reduce((s, a) => s + a, 0) / xs.length;
    return Math.sqrt(xs.reduce((s, a) => s + (a - mean) ** 2, 0) / xs.length) / (mean || 1);
  };
  const priceStepped = before.length >= 1 && spreadOf(before) < 0.05 && !samePrice(before[before.length - 1], last.amount);
  const spread = priceStepped ? Math.max(spreadOf(before), spreadOf(current)) : spreadOf(amounts);
  const typical = priceStepped ? median(current) : median(amounts);

  const lastDate = last.date;
  const nextExpected = addDays(lastDate, Math.round(medianGap));
  const overdueDays = daysBetween(nextExpected, today);
  // A series is "stopped" once it's late by half a cycle (min a week).
  const stopped = overdueDays > Math.max(7, medianGap * 0.5);

  const priceChange = priceStepped
    ? { from: before[before.length - 1], to: last.amount, since: txns[runStart].date }
    : null;

  return {
    cadence: cadence.id,
    intervalDays: round(medianGap),
    count: txns.length,
    typicalAmount: round(typical),
    lastAmount: last.amount,
    variableAmount: spread >= 0.15,
    firstDate: dates[0],
    lastDate,
    nextExpected,
    stopped,
    priceChange,
    yearlyCost: stopped ? 0 : round(typical * (365.25 / cadence.days)),
  };
}

/**
 * Detects regular payments (and regular earnings, e.g. a salary arriving by
 * bank transfer) in the ledger. Each series reports whether a recurring
 * template already covers it — either because its transactions were
 * materialised by one, or because a template has the same description.
 */
export function detectRegularSeries({ today = todayLocalDate() } = {}) {
  const since = addDays(today, -DETECTION_LOOKBACK_DAYS);
  const rows = db
    .prepare(
      `SELECT t.id, t.type, t.amount, t.description, t.date, t.recurring_id, t.category_id,
              c.name AS category_name, c.icon AS category_icon
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.date >= ? AND t.description IS NOT NULL AND t.description != ''
       ORDER BY t.date ASC, t.id ASC`
    )
    .all(since);

  const templateKeys = new Set(
    db
      .prepare('SELECT type, description FROM recurring_transactions')
      .all()
      .map((r) => `${r.type}|${normalizeDescription(r.description)}`)
  );

  const groups = new Map();
  for (const row of rows) {
    const norm = normalizeDescription(row.description);
    if (norm.length < 3) continue;
    const key = `${row.type}|${norm}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const series = [];
  for (const [key, txns] of groups) {
    const result = classifySeries(txns, today);
    if (!result) continue;
    const last = txns[txns.length - 1];
    series.push({
      key,
      type: last.type,
      description: last.description,
      category_id: last.category_id,
      category_name: last.category_name,
      category_icon: last.category_icon,
      tracked: txns.some((t) => t.recurring_id != null) || templateKeys.has(key),
      transactionIds: txns.map((t) => t.id),
      ...result,
    });
  }
  series.sort((a, b) => b.yearlyCost - a.yearlyCost);
  return series;
}

// ---------------------------------------------------------------------------
// Month-end forecast
// ---------------------------------------------------------------------------

// Occurrences of active recurring templates still to come in [from, until].
function scheduledFromTemplates(from, until) {
  const templates = db
    .prepare(
      `SELECT r.*, c.name AS category_name, c.icon AS category_icon
       FROM recurring_transactions r LEFT JOIN categories c ON c.id = r.category_id
       WHERE r.active = 1 AND r.next_due <= ?`
    )
    .all(until);
  const out = [];
  for (const t of templates) {
    let due = t.next_due;
    for (let i = 0; i < 400 && due <= until; i++) {
      if (due >= from) {
        out.push({
          date: due,
          type: t.type,
          amount: t.amount,
          description: t.description,
          category_id: t.category_id,
          category_name: t.category_name,
          category_icon: t.category_icon,
          source: 'recurring',
        });
      }
      due = advanceDueDate(due, t);
    }
  }
  return out;
}

/**
 * Projects the current month to its last day:
 *   projected = already recorded
 *             + scheduled (recurring templates, plus detected regular payments
 *               with no template whose next charge lands this month)
 *             + variable spending for the remaining days.
 * The variable daily rate blends the last three full months with this
 * month's own pace, weighted by how much of the month has elapsed. Spending
 * that belongs to a regular series is excluded from the rate (it's already
 * counted as scheduled). Earnings are never extrapolated — only scheduled.
 */
export function forecastCurrentMonth({ today = todayLocalDate() } = {}) {
  const month = currentLocalMonth();
  const monthStart = `${month}-01`;
  const totalDays = daysInMonthCount(month);
  const monthEnd = `${month}-${String(totalDays).padStart(2, '0')}`;
  const elapsedDays = Number(today.slice(8, 10));
  const daysLeft = totalDays - elapsedDays;
  const tomorrow = addDays(today, 1);

  const series = detectRegularSeries({ today });
  const regularIds = new Set(series.flatMap((s) => s.transactionIds));

  const scheduled = daysLeft > 0 ? scheduledFromTemplates(tomorrow, monthEnd) : [];
  for (const s of series) {
    if (s.tracked || s.stopped) continue;
    if (s.nextExpected >= tomorrow && s.nextExpected <= monthEnd) {
      scheduled.push({
        date: s.nextExpected,
        type: s.type,
        amount: s.lastAmount,
        description: s.description,
        category_id: s.category_id,
        category_name: s.category_name,
        category_icon: s.category_icon,
        source: 'detected',
      });
    }
  }
  scheduled.sort((a, b) => a.date.localeCompare(b.date));

  const categories = new Map(
    db
      .prepare('SELECT id, name, icon, color FROM categories')
      .all()
      .map((c) => [c.id, { ...c, spent: 0, earned: 0, scheduledSpending: 0, scheduledEarning: 0, variable: 0 }])
  );

  const monthRows = db
    .prepare('SELECT id, type, amount, category_id, recurring_id FROM transactions WHERE date >= ? AND date <= ?')
    .all(monthStart, monthEnd);
  const paceByCategory = new Map();
  for (const t of monthRows) {
    const c = categories.get(t.category_id);
    if (!c) continue;
    if (t.type === 'spending') {
      c.spent += t.amount;
      if (t.recurring_id == null && !regularIds.has(t.id)) {
        paceByCategory.set(t.category_id, (paceByCategory.get(t.category_id) || 0) + t.amount);
      }
    } else {
      c.earned += t.amount;
    }
  }

  for (const s of scheduled) {
    const c = categories.get(s.category_id);
    if (!c) continue;
    if (s.type === 'spending') c.scheduledSpending += s.amount;
    else c.scheduledEarning += s.amount;
  }

  // Historical variable spending per category over the last full months.
  const histFrom = `${shiftMonth(month, -VARIABLE_RATE_MONTHS)}-01`;
  const histDays = daysBetween(histFrom, monthStart);
  const histRows = db
    .prepare(
      `SELECT id, amount, category_id FROM transactions
       WHERE type = 'spending' AND recurring_id IS NULL AND date >= ? AND date < ?`
    )
    .all(histFrom, monthStart);
  const firstLedgerDate = db.prepare('SELECT MIN(date) AS d FROM transactions').get().d;
  // Don't divide by days before the ledger even started.
  const coveredHistDays = firstLedgerDate && firstLedgerDate > histFrom ? daysBetween(firstLedgerDate, monthStart) : histDays;
  const histByCategory = new Map();
  for (const t of histRows) {
    if (regularIds.has(t.id)) continue;
    histByCategory.set(t.category_id, (histByCategory.get(t.category_id) || 0) + t.amount);
  }

  const paceWeight = elapsedDays / totalDays;
  for (const c of categories.values()) {
    const histRate = coveredHistDays > 0 ? (histByCategory.get(c.id) || 0) / coveredHistDays : null;
    const paceRate = (paceByCategory.get(c.id) || 0) / elapsedDays;
    const rate = histRate == null ? paceRate : histRate * (1 - paceWeight) + paceRate * paceWeight;
    c.variable = round(rate * daysLeft);
  }

  const rows = [];
  const totals = {
    spent: 0,
    earned: 0,
    scheduledSpending: 0,
    scheduledEarning: 0,
    variableSpending: 0,
  };
  for (const c of categories.values()) {
    totals.spent += c.spent;
    totals.earned += c.earned;
    totals.scheduledSpending += c.scheduledSpending;
    totals.scheduledEarning += c.scheduledEarning;
    totals.variableSpending += c.variable;
    const projectedSpending = c.spent + c.scheduledSpending + c.variable;
    if (projectedSpending === 0 && c.earned === 0 && c.scheduledEarning === 0) continue;
    const budget = getEffectiveBudget(c.id, month);
    rows.push({
      category_id: c.id,
      category_name: c.name,
      category_icon: c.icon,
      category_color: c.color,
      spent: c.spent,
      scheduled: c.scheduledSpending,
      variable: c.variable,
      projectedSpending,
      earned: c.earned,
      projectedEarning: c.earned + c.scheduledEarning,
      budget: budget ? budget.amount : null,
      projectedOverBudget: budget && budget.amount > 0 ? projectedSpending - budget.amount : null,
    });
  }
  rows.sort((a, b) => b.projectedSpending - a.projectedSpending);

  const projectedSpending = totals.spent + totals.scheduledSpending + totals.variableSpending;
  const projectedEarning = totals.earned + totals.scheduledEarning;
  return {
    month,
    today,
    daysLeft,
    totals: { ...totals, projectedSpending, projectedEarning, projectedNet: projectedEarning - projectedSpending },
    categories: rows,
    scheduled,
  };
}

// ---------------------------------------------------------------------------
// Unusual spending
// ---------------------------------------------------------------------------

const UNUSUAL_MIN_EXCESS = 2500; // cents — ignore "3× a €2 coffee"

/**
 * Is this (already committed) spending unusually large? Compared first
 * against earlier charges with the same description (≥3 needed), else
 * against the category's spendings over the last 180 days (≥5 needed).
 * Returns { baseline, ratio, basis } or null.
 */
export function unusualSpendingFor(transaction) {
  if (!transaction || transaction.type !== 'spending') return null;

  const norm = normalizeDescription(transaction.description);
  if (norm.length >= 3) {
    const same = db
      .prepare(
        `SELECT amount, description FROM transactions
         WHERE type = 'spending' AND id != ? AND date <= ? AND description IS NOT NULL
           AND date >= ?`
      )
      .all(transaction.id, transaction.date, addDays(transaction.date, -DETECTION_LOOKBACK_DAYS))
      .filter((t) => normalizeDescription(t.description) === norm)
      .map((t) => t.amount);
    if (same.length >= 3) {
      const baseline = median(same);
      const ratio = transaction.amount / baseline;
      return ratio >= 2.5 && transaction.amount - baseline >= UNUSUAL_MIN_EXCESS
        ? { baseline: round(baseline), ratio, basis: 'description' }
        : null;
    }
  }

  const inCategory = db
    .prepare(
      `SELECT amount FROM transactions
       WHERE type = 'spending' AND category_id = ? AND id != ? AND date <= ? AND date >= ?`
    )
    .all(transaction.category_id, transaction.id, transaction.date, addDays(transaction.date, -180))
    .map((t) => t.amount);
  if (inCategory.length < 5) return null;
  const baseline = median(inCategory);
  const ratio = transaction.amount / baseline;
  return ratio >= 3 && transaction.amount - baseline >= UNUSUAL_MIN_EXCESS
    ? { baseline: round(baseline), ratio, basis: 'category' }
    : null;
}

/**
 * Categories whose last-7-days spend is running well above their usual week
 * (average over the previous 26 weeks). For the weekly summary.
 */
export function hotCategories({ today = todayLocalDate() } = {}) {
  const weekFrom = addDays(today, -6);
  const histFrom = addDays(weekFrom, -26 * 7);
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.icon,
              SUM(CASE WHEN t.date >= @weekFrom THEN t.amount ELSE 0 END) AS week,
              SUM(CASE WHEN t.date < @weekFrom THEN t.amount ELSE 0 END) AS hist,
              MIN(t.date) AS first
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.type = 'spending' AND t.date >= @histFrom AND t.date <= @today
       GROUP BY c.id`
    )
    .all({ weekFrom, histFrom, today });
  const out = [];
  for (const r of rows) {
    // Only categories with a few weeks of history have a "usual week".
    const histWeeks = Math.min(26, daysBetween(r.first, weekFrom) / 7);
    if (histWeeks < 4 || r.hist <= 0) continue;
    const usual = r.hist / histWeeks;
    const ratio = r.week / usual;
    if (ratio >= 2 && r.week - usual >= 2000) {
      out.push({ name: r.name, icon: r.icon, week: r.week, usual: round(usual), ratio });
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

export default { classifySeries, detectRegularSeries, forecastCurrentMonth, unusualSpendingFor, hotCategories };
