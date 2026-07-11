// Central place where all scheduled jobs (node-cron) are registered.
// Phase 1: nothing to schedule yet. Phases 4-6 will register:
//   - daily recurring-transaction processing
//   - IMAP polling
//   - weekly/monthly Discord summaries
export function registerCronJobs() {
  // no-op in Phase 1
}
