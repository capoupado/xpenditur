// Central place where all scheduled jobs (node-cron) are registered.
//   - Phase 4: daily recurring-transaction processing (+ a startup run so
//     downtime is backfilled the moment the server comes back up).
//   - Phase 5: weekly + monthly Discord summary notifications.
//   - Phase 6 will add IMAP polling.

import cron from 'node-cron';
import { processDueRecurring } from './services/recurring.js';
import { sendWeeklySummary, sendMonthlySummary } from './services/notifications.js';
import { getSettingNumber } from './services/settings-store.js';

const TZ = process.env.TZ || 'Europe/Lisbon';

function runRecurring(context) {
  try {
    const result = processDueRecurring();
    if (result.created > 0) {
      console.log(`[cron] recurring (${context}): created ${result.created} transaction(s).`);
    }
  } catch (err) {
    console.error(`[cron] recurring (${context}) failed:`, err);
  }
}

export function registerCronJobs() {
  // Backfill anything missed while the process was down. Synchronous & safe:
  // per-template DB transactions make this idempotent and crash-proof.
  runRecurring('startup');

  // Daily at 00:05 in the app timezone — a few minutes past midnight so the
  // local calendar date has definitively rolled over.
  cron.schedule('5 0 * * *', () => runRecurring('daily'), { timezone: TZ });

  // Weekly summary — every day at 09:00 the cron callback checks whether
  // today is the configured weekly_summary_day (settings key, default
  // 1 = Monday); node-cron's day-of-week field is fixed at registration time,
  // but the setting is user-editable at runtime, so we re-read it on every
  // tick instead of baking it into the cron expression.
  cron.schedule(
    '0 9 * * *',
    () => {
      const configuredDay = getSettingNumber('weekly_summary_day', 1);
      const today = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date());
      const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      if (WEEKDAYS[configuredDay] === today) {
        sendWeeklySummary();
      }
    },
    { timezone: TZ }
  );

  // Monthly summary — 1st of each month at 09:00, app timezone. Recaps the
  // month that just ended (sendMonthlySummary computes "previous month"
  // relative to whenever it's called).
  cron.schedule('0 9 1 * *', () => sendMonthlySummary(), { timezone: TZ });
}
