// Phase 5 seam — Discord webhook NotificationService lives here.
export default {};

// Phase 4 → Phase 5 seam.
// The recurring materialisation engine calls this hook once for every
// transaction it auto-creates, AFTER the per-template DB transaction has
// committed (so a future async Discord POST never runs inside a SQLite tx).
// Phase 5 will attach `sendRecurringReminder` (and budget-threshold alerts)
// here. It is intentionally a no-op today.
export function onRecurringMaterialised(transaction) {
  // no-op until Phase 5
  void transaction;
}
