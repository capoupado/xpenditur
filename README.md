# xPenditur

**xPenditur** is a self-hosted, single-user personal finance tracker built for EUR cash-flow tracking. It treats money movement as a pure ledger—no account balances, no future-dated transactions—and connects to your email for invoice auto-extraction via DeepSeek AI. All data stays on your server.

## Features

- **Transactions & Categories** — strict domain rules: category type must match transaction type, dates locked to today or earlier, mandatory categorization
- **Monthly Budgets** — spending limits per category with month-specific overrides; color-coded progress bars (green/yellow/orange/red)
- **Charts Dashboard** — spending by category, earnings vs. spending trends (last 6 months), daily breakdown, category tables
- **Recurring Transactions** — daily/weekly/monthly/yearly with backfill on downtime (no missed occurrences)
- **Discord Notifications** — threshold-crossing budget alerts (80% and 100%), weekly summaries (Monday), monthly recaps (1st of month)
- **Email Invoice Extraction** — IMAP polling with DeepSeek AI parsing; human review queue for pending transactions (with EUR-amount enforcement on non-EUR invoices)

## Quick Start

### Docker Compose (Recommended)

1. Clone and navigate to the project:
   ```bash
   cd xpenditur
   ```

2. Copy the environment template and configure:
   ```bash
   cp .env.example .env
   ```

3. Set these environment variables in `.env`:
   - `DEFAULT_USERNAME` / `DEFAULT_PASSWORD` — first-run only; used only if no user exists
   - `RESET_PASSWORD=true` — emergency lockout escape hatch; resets password to DEFAULT_PASSWORD on next boot (unset afterwards)
   - `JWT_SECRET` — random string for session signing (rotating it just logs you out)
   - `ENCRYPTION_KEY` — random string for encrypting IMAP/DeepSeek secrets at rest (rotating requires re-entering them in Settings)
   - `TZ` — app timezone (default: `Europe/Lisbon`); all dates and cron jobs use this single clock
   - `PORT` — listen port (default: 3000)

4. Launch:
   ```bash
   docker compose up
   ```

5. Access at http://localhost:3000 and log in with your `DEFAULT_USERNAME` and `DEFAULT_PASSWORD`.

**Important:** The `data/` volume contains your SQLite database file—back it up regularly.

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start dev servers (Express API + Vite frontend):
   ```bash
   npm run dev
   ```
   - Frontend: http://localhost:5173 (Vite with hot reload, proxies `/api` to Express)
   - Backend API: Express on port 3000

3. Build and run production:
   ```bash
   npm run build
   npm start
   ```

## Configuration

All settings beyond environment variables are managed in the **Settings UI** (accessible after login). Configure:

- **Discord Webhook** — webhook URL for notifications (test button included)
- **Budget Alert Threshold** — percentage at which alerts fire (default: 80%)
- **Weekly Summary Day** — day of week for recurring summary (default: Monday)
- **IMAP** — mailbox host, port, username, password; TLS toggle; poll interval; sender allow-list
- **DeepSeek API Key** — for invoice extraction
- Encrypted secrets use `ENCRYPTION_KEY`; changing it requires re-entering credentials.

## Domain Rules

xPenditur is a pure cash-flow ledger: no account balance, no carryover between months, no future-dated transactions. Every transaction is categorized; category type must match transaction type.

See **[CONTEXT.md](CONTEXT.md)** for complete semantics (Recurring Transaction backfill, Budget override semantics, Pending Transaction quarantine rules) and **[docs/adr/](docs/adr/)** for architectural decisions.

Key surprises:
- **No future dates** — recurring transactions are for scheduled, not manually-future transactions
- **Category type-matching enforced** — can't use a "spending" category for earnings
- **Non-EUR invoices quarantined** — you must supply the real EUR amount at approval
- **Monthly net only** — "balance" means this month's earnings minus spendings, resets every month

## Tech Stack

- **Backend** — Node.js, Express, better-sqlite3
- **Frontend** — React (Vite), Tailwind CSS, Recharts
- **Deployment** — Docker Compose (single container, volumes for data)
- **Currency** — EUR throughout (amounts in cents, displayed as €XX.XX)
- **Auth** — Single-user JWT (httpOnly cookie)
