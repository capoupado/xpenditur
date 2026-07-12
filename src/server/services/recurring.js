// Phase 4 — recurring transaction materialisation engine.
//
// A recurring_transactions row is a TEMPLATE. This engine turns due templates
// into real transactions ("materialisation"), backfilling every missed
// occurrence at its actual due date (no cap) and advancing next_due past today.
//
// Invariants (see CONTEXT.md → Recurring Transaction):
//   - Every missed occurrence is materialised, each dated its actual due date.
//   - Materialised transactions are immutable history; template edits only
//     affect FUTURE materialisation.
//   - Monthly/yearly advance clamps the template's day_of_month to short
//     months' last day, and the clamp does NOT stick (we always re-clamp from
//     the template's original anchor day).
//   - Per-template work runs inside a single SQLite transaction, so a crash
//     mid-backfill can never double-materialise. Running twice is idempotent:
//     the second run finds next_due > today and does nothing.

import db from '../db.js';
import { todayLocalDate, addDays, clampDayToMonth, daysBetween, nthWeekdayOfMonth } from '../utils/dates.js';
import { onRecurringMaterialised } from './notifications.js';

// How many days behind "today" a template may be before we log a catch-up warning.
const BACKFILL_WARN_DAYS = 31;

// Hard safety valve: even with no cap on legitimate backfill, guard against a
// bug producing a non-advancing loop. 200 years of daily occurrences.
const MAX_ITERATIONS = 200 * 366;

/**
 * Computes the next due date for a template given its current due date.
 * `frequency` decides the step; monthly/yearly clamp `day_of_month` to the
 * target month, always from the template's anchor day (never the clamped one).
 */
export function advanceDueDate(currentDue, template) {
  const ym = currentDue.slice(0, 7);
  switch (template.frequency) {
    case 'daily':
      return addDays(currentDue, 1);
    case 'weekly':
      return addDays(currentDue, 7);
    case 'monthly':
      // Weekday mode: "Nth/last <weekday> of the month" (week_of_month 1-4 or
      // -1 = last) instead of a fixed day_of_month.
      if (template.week_of_month != null) {
        return nthWeekdayOfMonth(shift(ym, 1), template.day_of_week, template.week_of_month);
      }
      return clampDayToMonth(shift(ym, 1), template.day_of_month);
    case 'yearly':
      // Anchor day is stored in day_of_month at creation time (derived from the
      // initial next_due when the client doesn't supply one), so Feb-29 yearly
      // templates re-expand to the 29th in leap years instead of sticking at 28.
      return clampDayToMonth(shift(ym, 12), template.day_of_month);
    default:
      throw new Error(`Unknown frequency: ${template.frequency}`);
  }
}

/**
 * First occurrence of an "Nth/last weekday of the month" rule on or after
 * `fromDate` (YYYY-MM-DD). Used to derive next_due when a weekday-mode
 * template is created/edited without an explicit date.
 */
export function firstWeekdayOccurrenceOnOrAfter(fromDate, dayOfWeek, weekOfMonth) {
  const ym = fromDate.slice(0, 7);
  const candidate = nthWeekdayOfMonth(ym, dayOfWeek, weekOfMonth);
  if (candidate >= fromDate) return candidate;
  return nthWeekdayOfMonth(shift(ym, 1), dayOfWeek, weekOfMonth);
}

// Shift a YYYY-MM string by `delta` months (local copy to avoid importing the
// month helper for a one-liner and to keep this module self-contained).
function shift(monthStr, delta) {
  const [year, month] = monthStr.split('-').map(Number);
  const zeroBased = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = (zeroBased % 12) + 1;
  return `${String(newYear).padStart(4, '0')}-${String(newMonth).padStart(2, '0')}`;
}

const insertTxStmt = () =>
  db.prepare(
    `INSERT INTO transactions (type, amount, description, category_id, date, recurring_id)
     VALUES (@type, @amount, @description, @category_id, @date, @recurring_id)`
  );

/**
 * Materialise a single template up to (and including) `today`. Runs inside one
 * SQLite transaction. Returns the list of created transaction rows (empty if
 * nothing was due). Does NOT fire notification hooks — the caller does that
 * after commit.
 */
function processTemplate(template, today) {
  const insert = insertTxStmt();

  const run = db.transaction(() => {
    const createdIds = [];
    let due = template.next_due;
    let iterations = 0;

    while (due <= today) {
      if (++iterations > MAX_ITERATIONS) {
        throw new Error(
          `Recurring template ${template.id} exceeded ${MAX_ITERATIONS} materialisation iterations — aborting to avoid a runaway loop.`
        );
      }
      const info = insert.run({
        type: template.type,
        amount: template.amount,
        description: template.description,
        category_id: template.category_id,
        date: due,
        recurring_id: template.id,
      });
      createdIds.push(info.lastInsertRowid);
      due = advanceDueDate(due, template);
    }

    db.prepare('UPDATE recurring_transactions SET next_due = ? WHERE id = ?').run(due, template.id);
    return createdIds;
  });

  const createdIds = run();
  if (createdIds.length === 0) return [];

  const lag = daysBetween(template.next_due, today);
  if (lag > BACKFILL_WARN_DAYS) {
    console.warn(
      `[recurring] Backfilled template ${template.id} (${template.frequency}) — ` +
        `${createdIds.length} occurrence(s) catching up ${lag} days of lag ` +
        `(first due ${template.next_due}, today ${today}).`
    );
  }

  const getTx = db.prepare('SELECT * FROM transactions WHERE id = ?');
  return createdIds.map((id) => getTx.get(id));
}

/**
 * Process every active template whose next_due is on or before today (local,
 * TZ-aware). Backfills all missed occurrences and advances next_due past today.
 * Idempotent: a second immediate run finds nothing due.
 *
 * @returns {{ processedTemplates: number, created: number }}
 */
export function processDueRecurring() {
  const today = todayLocalDate();
  const templates = db
    .prepare('SELECT * FROM recurring_transactions WHERE active = 1 AND next_due <= ? ORDER BY id ASC')
    .all(today);

  let created = 0;
  const materialised = [];

  for (const template of templates) {
    const rows = processTemplate(template, today);
    created += rows.length;
    materialised.push(...rows);
  }

  // Fire the Phase 5 seam AFTER all DB transactions have committed.
  for (const tx of materialised) {
    try {
      onRecurringMaterialised(tx);
    } catch (err) {
      console.error('[recurring] notification hook failed (non-fatal):', err);
    }
  }

  if (created > 0) {
    console.log(
      `[recurring] Materialised ${created} transaction(s) from ${templates.length} due template(s).`
    );
  }

  return { processedTemplates: templates.length, created };
}

export default { processDueRecurring, advanceDueDate, firstWeekdayOccurrenceOnOrAfter };
