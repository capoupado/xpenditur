// Central place where all scheduled jobs (node-cron) are registered.
//   - Phase 4: daily recurring-transaction processing (+ a startup run so
//     downtime is backfilled the moment the server comes back up).
//   - Phases 5-6 will add IMAP polling and weekly/monthly Discord summaries.

import cron from 'node-cron';
import { processDueRecurring } from './services/recurring.js';

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
}
