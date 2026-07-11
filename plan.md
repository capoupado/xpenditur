# xPenditur — Full Project Prompt

You are building **xPenditur**, a self-hosted personal finance tracker for a single user. Build it incrementally across the phases below. Each phase should result in a fully working app before moving to the next.

Domain vocabulary and invariants live in `CONTEXT.md`; architectural decisions in `docs/adr/`. Where this plan and `CONTEXT.md` conflict, `CONTEXT.md` wins.

**Core stance (see ADR-0001):** xPenditur is a pure cash-flow ledger. "Balance" always means monthly net (earnings − spendings for one month). There is no account balance, starting balance, or carryover.

---

## Tech Stack

- **Backend:** Node.js + Express + better-sqlite3
- **Frontend:** React (Vite) with Recharts for charts, Tailwind CSS for styling
- **Auth:** Single-user, username/password with JWT (httpOnly cookie)
- **Database:** SQLite (single file, volume-mounted in Docker for easy backup)
- **Deployment:** Docker Compose on a Linux VPS (behind a reverse proxy like Nginx/Caddy)
- **Currency:** EUR (€) throughout — all amounts stored as integers in cents

---

## Database Schema

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('earning', 'spending', 'both')),
  icon TEXT,              -- optional emoji or icon name
  color TEXT,             -- hex color for charts
  is_system INTEGER DEFAULT 0,      -- 1 for the protected "Other" category
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('earning', 'spending')),
  amount INTEGER NOT NULL,          -- cents
  description TEXT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  date DATE NOT NULL,
  recurring_id INTEGER REFERENCES recurring_transactions(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recurring_transactions (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('earning', 'spending')),
  amount INTEGER NOT NULL,          -- cents
  description TEXT,
  category_id INTEGER REFERENCES categories(id),
  frequency TEXT NOT NULL CHECK(frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  day_of_month INTEGER,             -- for monthly (1-31)
  day_of_week INTEGER,              -- for weekly (0=Sun, 6=Sat)
  next_due DATE NOT NULL,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE budgets (
  id INTEGER PRIMARY KEY,
  category_id INTEGER REFERENCES categories(id),
  amount INTEGER NOT NULL,          -- cents, monthly limit
  month TEXT,                       -- 'YYYY-MM' or NULL for every month (default budget)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category_id, month)
);
-- SQLite treats NULLs as distinct in UNIQUE, so also enforce
-- "one default budget per category" with a partial unique index:
CREATE UNIQUE INDEX budgets_one_default_per_category
  ON budgets(category_id) WHERE month IS NULL;

CREATE TABLE pending_transactions (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('earning', 'spending')),
  amount INTEGER NOT NULL,          -- cents (in `currency` units; EUR unless quarantined)
  currency TEXT NOT NULL DEFAULT 'EUR',  -- as extracted; non-EUR rows are quarantined
  description TEXT,
  suggested_category_id INTEGER NOT NULL REFERENCES categories(id),  -- falls back to "Other"
  date DATE NOT NULL,               -- falls back to email received date
  source_email_subject TEXT,
  source_email_from TEXT,
  source_email_date DATETIME,
  raw_extracted_json TEXT,          -- full AI extraction result
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  transaction_id INTEGER REFERENCES transactions(id),  -- set on approval
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE processed_emails (
  message_id TEXT PRIMARY KEY,      -- IMAP Message-ID header
  processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Settings keys: discord_webhook_url, imap_host, imap_port, imap_user,
-- imap_password, imap_poll_interval_minutes, deepseek_api_key,
-- notification_budget_threshold (default 80), weekly_summary_day (default 1=Monday)
```

---

## Phase 1 — Core CRUD + Auth

Build the foundation: authentication, transaction management, and categories.

### Backend API

- `POST /api/auth/login` — returns JWT in httpOnly cookie
- `POST /api/auth/logout` — clears cookie
- `GET  /api/auth/me` — returns current user info
- `POST /api/auth/change-password` — current password + new password
- `GET/POST /api/categories` — list and create categories
- `PUT/DELETE /api/categories/:id` — update and delete
- `GET /api/transactions` — list with filters (type, category, date range, pagination)
- `POST /api/transactions` — create transaction
- `PUT/DELETE /api/transactions/:id` — update and delete

### Domain Rules (enforced in validation — see CONTEXT.md)

- A transaction's type must match its category's type (`both` matches either). Rejecting a category-type edit that would leave existing transactions mismatched.
- `category_id` is mandatory on every transaction; the form defaults to "Other".
- Transaction dates must be ≤ today (no future-dated transactions).
- "Other" is a protected system category (`is_system = 1`, type `both`): it cannot be deleted; cosmetic edits are allowed.
- Deleting an in-use category is reassign-on-delete: `DELETE /api/categories/:id?reassign_to=<id>` moves its transactions to the destination category and deletes its budgets and recurring transactions. The UI asks for the destination.

### Frontend Pages

- **Login page** — simple username/password form
- **Dashboard** — summary cards (total earnings, total spending, balance this month)
- **Transactions page** — table/list with filters (date range, type, category), add/edit/delete
- **Categories page** — manage custom categories (name, type, icon, color)

### Seed Data

On first run, if no user exists, create a default user from env vars (`DEFAULT_USERNAME`, `DEFAULT_PASSWORD`). **These env vars are first-run only** — they have no effect once the user exists. Password changes happen in Settings; setting `RESET_PASSWORD=true` resets the password to `DEFAULT_PASSWORD` on next boot (lockout escape hatch — document unsetting it afterwards).

Seed default categories: Salary, Freelance, Food, Rent, Utilities, Transport, Entertainment, Health, Subscriptions, Other. "Other" is seeded with type `both` and `is_system = 1`.

---

## Phase 2 — Charts & Monthly Summaries

Add visual insights to the dashboard.

### Charts (use Recharts)

- **Spending by category** — pie/donut chart for current month
- **Earnings vs Spending** — bar chart, last 6 months
- **Spending trend** — line chart, daily spending over current month
- **Category breakdown table** — sortable, with totals

### API Additions

- `GET /api/stats/monthly?month=YYYY-MM` — aggregated stats for a month
- `GET /api/stats/trends?months=6` — multi-month trend data
- `GET /api/stats/categories?month=YYYY-MM` — per-category breakdown

### Frontend

- Dashboard becomes the charts hub with a month picker
- Each chart should be a reusable component

---

## Phase 3 — Budgets & Budget Goals

### Backend

- `GET/POST /api/budgets` — list and create budget limits
- `PUT/DELETE /api/budgets/:id` — update and delete
- `GET /api/budgets/status?month=YYYY-MM` — returns each budget with current spend and percentage

### Budget Semantics (see CONTEXT.md)

- Budgets are **spending limits only** — no budgets on earnings; a `both` category's budget counts only its spendings.
- A category may have a **default budget** (`month IS NULL`, applies every month) and **month budgets** (`month = 'YYYY-MM'`). A month budget **overrides** the default for that month — they never add. The effective budget for a month is: month budget if present, else default.

### Frontend

- **Budgets page** — set monthly limit per category
- **Budget progress bars** — on dashboard, show each category's spend vs limit
- Color coding: green (<60%), yellow (60-80%), orange (80-100%), red (>100%)

---

## Phase 4 — Recurring Transactions

### Backend

- `GET/POST /api/recurring` — list and create recurring transactions
- `PUT/DELETE /api/recurring/:id` — update, deactivate, delete
- **Cron job** (runs daily via node-cron): check `recurring_transactions` where `next_due <= today` and `active = 1`. For each, **backfill**: loop creating one transaction per missed occurrence, each dated its actual due date, until `next_due` is in the future. No backfill cap; log a warning when catching up more than 31 days.

### Recurring Semantics (see CONTEXT.md)

- Materialised transactions are **immutable history**: template edits affect only future occurrences; deleting a template stops future occurrences and leaves past transactions untouched (their `recurring_id` is nulled via `ON DELETE SET NULL`). Wrong instances are corrected by editing the transaction itself.
- `day_of_month` beyond a short month's end clamps to the month's last day (31 → Feb 28/29).

### Frontend

- **Recurring page** — manage recurring transactions (amount, category, frequency, next due)
- Badge on dashboard showing upcoming recurring transactions in the next 7 days

---

## Phase 5 — Discord Notifications

### Implementation

- Use a simple `fetch` POST to the Discord webhook URL stored in settings.
- Create a `NotificationService` class with methods:
  - `sendBudgetAlert(category, spent, limit, percentage)` — fired only on a **threshold crossing**: a transaction (from any source — manual, recurring materialisation, pending approval) moves the category's monthly spend from below 80% (or 100%) of its effective budget to at-or-above it. Computed statelessly by comparing spend-before vs spend-after; no alert-state table. Deletions naturally re-arm thresholds.
  - `sendRecurringReminder(transaction)` — sent when a recurring transaction is auto-created
  - `sendWeeklySummary()` — cron job, runs every Monday: total spent, top 3 categories, budget statuses
  - `sendMonthlySummary()` — cron job, runs 1st of each month: full month recap, earnings vs spending, budget performance

### Discord Message Format

Use Discord embeds for rich formatting:
- Color-coded (green for earnings, red for overspend, blue for summaries)
- Fields for key metrics
- Footer with timestamp

### Settings UI

- Settings page to configure Discord webhook URL
- Test button to send a test notification

---

## Phase 6 — Email Invoice Auto-Tracking (IMAP + DeepSeek)

### IMAP Polling Service

- Use `imapflow` npm package to connect to the configured mailbox
- Poll on a configurable interval (default: 15 minutes) via node-cron
- **The mailbox is read-only to the app**: never mark emails read, never set flags. Search by **date window** (e.g. since last successful poll, with overlap), not by unread state — so the user reading their mail first can never hide an invoice from the tracker.
- Match invoice/receipt indicators:
  - Subject keywords: "invoice", "receipt", "payment", "order confirmation", "fatura", "recibo", "pagamento"
  - From known senders (configurable allow-list in settings, optional)
- Deduplicate solely via the `processed_emails` table keyed on the Message-ID header — record every examined matching email there, whether or not extraction succeeds

### DeepSeek Parsing

- Send the email body (plain text or stripped HTML) to the DeepSeek API (`https://api.deepseek.com/v1/chat/completions`, OpenAI-compatible format)
- Use model `deepseek-chat`
- System prompt for extraction:

```
You are a financial document parser. Extract transaction details from the following email.
Respond ONLY with a JSON object, no other text:
{
  "vendor": "string — who was paid or who sent the invoice",
  "type": "spending | earning — was this money the user paid out, or money they received (refund, payout)? If unsure, use spending",
  "amount": number — total amount (use the final/total amount),
  "currency": "string — ISO 4217 code of the amount as stated in the email, e.g. EUR, USD",
  "date": "YYYY-MM-DD — transaction or invoice date",
  "description": "string — brief description of what was purchased/paid",
  "category_suggestion": "string — best matching category from: [dynamically insert user's category names]",
  "confidence": number — 0 to 1, how confident you are in the extraction
}
If you cannot extract meaningful transaction data, return: {"error": "Could not parse invoice"}
```

- Create a `pending_transaction` with the extracted data, filling gaps so every row is complete: unmatched/missing `category_suggestion` → the "Other" category; missing `date` → the email's received date; missing `type` → `spending`; missing `currency` → `EUR`
- Store the full AI response in `raw_extracted_json` for debugging

### Frontend

- **Pending Transactions page** — shows `pending` rows by default, with a filter to view approved/rejected history
- Each pending item shows: vendor, type, amount (+ currency warning if non-EUR), date, suggested category, confidence score, source email subject
- Actions: Approve (creates the transaction, sets `status = 'approved'` and `transaction_id`), Edit & Approve (change any field, including type, before approving), Reject (sets `status = 'rejected'` — **rows are never deleted**; they are the extraction pipeline's audit log)
- Plain Approve always succeeds — **except non-EUR rows, which are quarantined**: plain Approve is blocked and the user must enter the real EUR amount via Edit & Approve. Bulk approve skips quarantined rows and reports the skips; bulk reject works on anything.
- Visual confidence indicator (green >0.8, yellow 0.5-0.8, red <0.5)

### Settings UI additions

- IMAP configuration: host, port, username, password, TLS toggle
- DeepSeek API key
- Poll interval
- Email sender allow-list (optional filter)
- Test connection button for IMAP

---

## Non-Functional Requirements

### Docker Compose Structure

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data    # SQLite file lives here
    env_file:
      - .env
    restart: unless-stopped
```

Single container — the Express server serves both the API and the built React static files. Cron jobs (recurring transactions, IMAP polling, scheduled notifications) run inside the app process via `node-cron`.

### Environment Variables (.env)

```
DEFAULT_USERNAME=admin          # first-run seed only
DEFAULT_PASSWORD=changeme       # first-run seed only (also used by RESET_PASSWORD)
RESET_PASSWORD=false            # set true for one boot to reset the password to DEFAULT_PASSWORD
JWT_SECRET=generate-a-random-string      # session signing only; rotating it just logs you out
ENCRYPTION_KEY=generate-another-random-string  # encrypts IMAP/DeepSeek secrets at rest; rotating it requires re-entering them
TZ=Europe/Lisbon                # the single app timezone — all dates, month boundaries, and cron schedules use it
NODE_ENV=production
PORT=3000
```

All other config (Discord webhook, IMAP, DeepSeek key) is stored in the `settings` DB table and managed via the Settings UI.

### Project Structure

```
xPenditur/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
├── vite.config.js
├── src/
│   ├── server/
│   │   ├── index.js              # Express entry point
│   │   ├── db.js                 # SQLite setup + migrations
│   │   ├── middleware/
│   │   │   └── auth.js           # JWT middleware
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── transactions.js
│   │   │   ├── categories.js
│   │   │   ├── budgets.js
│   │   │   ├── recurring.js
│   │   │   ├── pending.js
│   │   │   ├── stats.js
│   │   │   └── settings.js
│   │   ├── services/
│   │   │   ├── notifications.js  # Discord webhook logic
│   │   │   ├── imap.js           # IMAP polling + email fetching
│   │   │   ├── invoice-parser.js # DeepSeek API integration
│   │   │   └── recurring.js      # Recurring transaction processor
│   │   └── cron.js               # All scheduled jobs
│   └── client/
│       ├── index.html
│       ├── App.jsx
│       ├── pages/
│       │   ├── Login.jsx
│       │   ├── Dashboard.jsx
│       │   ├── Transactions.jsx
│       │   ├── Categories.jsx
│       │   ├── Budgets.jsx
│       │   ├── Recurring.jsx
│       │   ├── Pending.jsx
│       │   └── Settings.jsx
│       └── components/
│           ├── Layout.jsx
│           ├── TransactionForm.jsx
│           ├── Charts/
│           └── BudgetProgress.jsx
└── data/
    └── xPenditur.db
```

### UI/UX Guidelines

- Clean, minimal design — dark mode preferred
- Mobile-responsive (will be accessed from phone)
- Use Tailwind CSS utility classes
- Amounts always displayed as `€XX.XX` (convert from cents on display)
- Dates in `DD/MM/YYYY` format (European)
- Toast notifications for success/error feedback
- Confirm dialogs before destructive actions (delete)

### Security

- All API routes (except login) require valid JWT
- Passwords hashed with bcrypt
- IMAP password and DeepSeek API key encrypted at rest in the settings table with AES using the dedicated `ENCRYPTION_KEY` (never `JWT_SECRET` — the two must rotate independently). On boot, if stored secrets fail to decrypt, log a clear "ENCRYPTION_KEY changed — re-enter credentials in Settings" message instead of an opaque crypto error, and treat those settings as unset.
- Rate limiting on login endpoint
- Input validation and sanitization on all endpoints