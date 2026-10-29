# xPenditur — Ubiquitous Language

## Terms

### App Timezone
The single clock the whole system thinks in: **Europe/Lisbon** (configured, not hardcoded). Every date — transaction dates, month boundaries, cron schedules, "today" — is a local date in this zone. There is no per-request or UTC handling.

### Transaction
A single dated money movement, either an **Earning** or a **Spending**. The atomic fact of the ledger: it records only money that has actually moved. **Future-dated Transactions are rejected** (date must be ≤ today); known upcoming payments are the job of Recurring Transactions.

### Earning
A Transaction representing money received.

### Spending
A Transaction representing money paid out.

### Category
A user-defined label for grouping Transactions. Every Category has a type: `earning`, `spending`, or `both`. **A Transaction may only use a Category whose type matches the Transaction's type** (`both` matches either). This is enforced at validation, not merely suggested in the UI. A Category's type cannot be changed if the change would leave existing Transactions mismatched.

Every Transaction **must** have a Category (`category_id NOT NULL`). There is no "uncategorized" state; the seeded "Other" Category is the explicit catch-all.

**"Other" is a protected system Category**: type `both`, cannot be deleted (cosmetic edits allowed). It is the guaranteed reassignment target and the transaction form's default.

Deleting a Category in use is a **reassign-on-delete**: the user picks a destination Category for its Transactions; Budgets and Recurring Transactions under the deleted Category are removed with it.

### Budget
A monthly **spending limit** for one Category. Budgets never apply to Earnings; a `both` Category's Budget counts only its Spendings.

A Budget is either a **Default Budget** (applies every month) or a **Month Budget** (applies to one specific month). When both exist for a Category, the Month Budget **overrides** the Default Budget for that month — they do not add. A Category has at most one Default Budget and at most one Month Budget per month.

### Recurring Transaction
A template that automatically materialises Transactions on a schedule (daily / weekly / monthly / yearly). Materialised Transactions are ordinary Transactions carrying a provenance link to their template.

**Backfill rule:** when processing runs after missed due dates (e.g. server downtime), every missed occurrence is materialised, each dated its actual due date — no occurrence is ever silently skipped. There is no backfill cap.

**Pause rule:** deactivating a template means its occurrences during the pause *never happened* — unlike downtime, a pause is deliberate. On reactivation, materialisation resumes from the next future occurrence with no catch-up.

**Immutable history:** template edits affect only future materialisation; deleting a template stops future occurrences and severs (nulls) the provenance link on past Transactions, which survive untouched. Correcting a wrongly-materialised Transaction means editing that Transaction directly. `day_of_month` beyond a short month's end clamps to the month's last day.

**Monthly weekday mode:** a monthly template can alternatively schedule on the Nth (1st–4th) or last weekday of the month (`week_of_month` 1–4 or -1, plus `day_of_week`), e.g. "last Friday" for a salary. In this mode `next_due` is always derived from the rule (never hand-picked), and there is deliberately no "5th weekday" option — most months lack one, so no skip semantics exist.

### Budget Alert
A Discord notification fired when a Transaction (from any source: manual entry, recurring materialisation, or pending approval) moves a Category's monthly spend **across** the 80% or 100% threshold of its effective Budget (spend-before below, spend-after at-or-above). Alerts are stateless: dropping back below a threshold re-arms it naturally.

### Pending Transaction
A candidate Transaction awaiting the user's ruling — AI-extracted from an email, imported from a bank statement file (CSV/PDF), or synced from a connected bank. It is **not** a Transaction and never appears in the ledger, stats, or budgets. Lifecycle: `pending` → `approved` (a real Transaction is created and linked) or `rejected`. **Rows are retained after ruling** as an audit log of the extraction pipeline; nothing is deleted on reject.

The extractor decides whether the email describes an Earning or a Spending (defaulting to Spending when unsure); the user can override the type at Edit & Approve.

**Always approvable by construction:** gaps are filled at extraction time — an unmatched or missing category suggestion becomes "Other", a missing date becomes the email's received date. Plain Approve (and bulk approve) therefore never fails; Edit & Approve exists to disagree with the AI, not to repair it.

**Exception — future date:** a Pending Transaction whose extracted date is in the future cannot be plain-approved (the ledger's no-future-dates rule wins); the user supplies a valid date via Edit & Approve.

**Exception — foreign currency:** the extractor also reports the currency. A non-EUR Pending Transaction is quarantined: plain Approve is blocked (and bulk approve skips it, reporting the skip); the user must supply the real EUR amount via Edit & Approve. The app never converts currency itself.

**Read-only mailbox:** the poller never alters the mailbox (no read-marking, no flags). It searches by date window and deduplicates via its own processed-email record keyed on mailbox account + Message-ID.

**Manual backfill poll:** besides the scheduled incremental poll, the user can poll an explicit from/to date window (Pending → "Poll range…") to reach months the incremental window never covered. A ranged poll never advances the incremental poll cursor, and dedup makes re-polling a covered window harmless.

**Bank sync (Enable Banking):** transactions can be pulled directly from banks through the Enable Banking PSD2 aggregator. The user registers a personal application at enablebanking.com (application ID + RSA private key, stored encrypted like other secrets) and authorizes each bank through its own consent page (~90-day PSD2 consents; the connection shows its expiry and must be re-authorized after). Only booked transactions are synced — daily at 07:30 plus on-demand — and land as Pending rows (never in the ledger directly), deduplicated by the bank's entry reference. Non-EUR rows follow the normal foreign-currency quarantine.

**Statement file import:** bank statement exports (built for CGD and Novo Banco conventions, tolerant of generic layouts) can be imported on the Pending page. CSV is parsed deterministically — no AI involved; PDF text is extracted and parsed by the configured AI provider. Imported rows are always EUR, default to the "Other" category, and enter the same pending → approved/rejected lifecycle. Dedup is per row content (date + type + amount + description, with an occurrence counter so identical same-day rows survive), so re-importing the same or an overlapping export is harmless.

**Multiple mailboxes:** any number of IMAP accounts can be polled (each with its own credentials, sender allow-list, poll cursor, and enable switch); one poll cycle covers every active account. Each Pending Transaction records which mailbox it came from. Deleting a mailbox keeps its Pending rows (provenance link nulled) but drops its dedup history.

### Monthly Net (shown as "Balance")
Earnings minus Spendings **within one calendar month**. xPenditur is a pure cash-flow ledger: there is no starting balance, no carryover between months, and no notion of "current account balance". The app answers "how did this month go?", never "how much money do I have?".
