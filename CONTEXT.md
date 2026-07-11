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

**Immutable history:** template edits affect only future materialisation; deleting a template stops future occurrences and severs (nulls) the provenance link on past Transactions, which survive untouched. Correcting a wrongly-materialised Transaction means editing that Transaction directly. `day_of_month` beyond a short month's end clamps to the month's last day.

### Budget Alert
A Discord notification fired when a Transaction (from any source: manual entry, recurring materialisation, or pending approval) moves a Category's monthly spend **across** the 80% or 100% threshold of its effective Budget (spend-before below, spend-after at-or-above). Alerts are stateless: dropping back below a threshold re-arms it naturally.

### Pending Transaction
An AI-extracted candidate Transaction from an email, awaiting the user's ruling. It is **not** a Transaction and never appears in the ledger, stats, or budgets. Lifecycle: `pending` → `approved` (a real Transaction is created and linked) or `rejected`. **Rows are retained after ruling** as an audit log of the extraction pipeline; nothing is deleted on reject.

The extractor decides whether the email describes an Earning or a Spending (defaulting to Spending when unsure); the user can override the type at Edit & Approve.

**Always approvable by construction:** gaps are filled at extraction time — an unmatched or missing category suggestion becomes "Other", a missing date becomes the email's received date. Plain Approve (and bulk approve) therefore never fails; Edit & Approve exists to disagree with the AI, not to repair it.

**Sole exception — foreign currency:** the extractor also reports the currency. A non-EUR Pending Transaction is quarantined: plain Approve is blocked (and bulk approve skips it, reporting the skip); the user must supply the real EUR amount via Edit & Approve. The app never converts currency itself.

**Read-only mailbox:** the poller never alters the mailbox (no read-marking, no flags). It searches by date window and deduplicates via its own processed-email record keyed on Message-ID.

### Monthly Net (shown as "Balance")
Earnings minus Spendings **within one calendar month**. xPenditur is a pure cash-flow ledger: there is no starting balance, no carryover between months, and no notion of "current account balance". The app answers "how did this month go?", never "how much money do I have?".
