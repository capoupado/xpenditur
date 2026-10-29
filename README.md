# xPenditur

**xPenditur** is a self-hosted, single-user personal finance tracker built for EUR cash-flow tracking. It treats money movement as a pure ledger—no account balances, no future-dated transactions—and pulls transactions from your bank (or statement files) into a review queue, with AI help from the provider of your choice. All data stays on your server.

## Features

- **Transactions & Categories** — strict domain rules: category type must match transaction type, dates locked to today or earlier, mandatory categorization
- **Monthly Budgets** — spending limits per category with month-specific overrides; color-coded progress bars (green/yellow/orange/red)
- **Charts Dashboard** — spending by category, earnings vs. spending trends (last 6 months), daily breakdown, category tables
- **Insights** — month-end forecast (recorded + scheduled + usual variable spending, per category vs budget); regular-payment radar (detected subscriptions/bills with cadence, yearly cost, price changes, stopped charges and missing recurring templates); "Ask your ledger" natural-language questions answered by the AI provider over a read-only, ledger-only copy of the data — or category fixes ("merchant XYZ is actually Other") shown as a preview, applied on confirm, with undo
- **Recurring Transactions** — daily/weekly/monthly/yearly with backfill on downtime (no missed occurrences)
- **Notifications (Push + Discord)** — installable PWA with Web Push; per notification type pick push, Discord, both or off: pending-transaction reminders (at chosen hours), auto-approvals, threshold-crossing budget alerts (80% and 100%), unusual-spending alerts, bank-consent expiry warnings (14/7/3/1/0 days, plus an in-app banner with Reconnect), recurring materialisations, weekly summaries and monthly recaps. Push needs HTTPS (on iPhone, add to Home Screen first)
- **Review Queue (Pending)** — bank-synced and imported rows are categorized automatically and confident matches (≥80%, configurable) are approved on their own, the rest wait for approval; categories are suggested from your own ledger history first, then by the AI provider (OpenCode, OpenAI, Anthropic, Gemini, DeepSeek, Mistral, Groq, xAI, OpenRouter, or any OpenAI-compatible server); non-EUR rows need the real EUR amount at approval
- **Bank Statement Import** — upload CSV (parsed deterministically; CGD/Novo Banco export conventions supported) or PDF (parsed via the AI provider) statements into the review queue
- **Bank Sync (Enable Banking)** — pull transactions directly from your banks via the Enable Banking PSD2 aggregator; daily + on-demand sync into the review queue; the app serves its own `/privacy` and `/terms` pages required for an Enable Banking production application

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
   - `ENCRYPTION_KEY` — random string for encrypting AI provider / bank secrets at rest (rotating requires re-entering them in Settings)
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
- **AI provider** — provider, API key and model (the model list is fetched live from the provider) for PDF statement parsing and AI categorization. Each provider keeps its own key and model, so you can switch back and forth
- **Enable Banking** — application ID, RSA private key, and redirect URL for direct bank sync (see below)
- Encrypted secrets use `ENCRYPTION_KEY`; changing it requires re-entering credentials.

## Deploying to a VPS (and migrating existing data)

The app is stateless apart from two things: the **`data/` directory** (SQLite database) and the **`.env` secrets**. Moving machines is a copy of both.

1. **Stop the app on the old machine** (so the SQLite WAL is quiescent), then copy the entire `data/` directory (including any `-wal`/`-shm` files) to the VPS.
2. **Copy `.env` values — `ENCRYPTION_KEY` must be byte-identical.** Every secret stored in the DB (AI provider keys, Enable Banking private key) is encrypted with it; a different key makes them unrecoverable and you'd re-enter them in Settings. `JWT_SECRET` may change (it only logs you out). Review `TZ`, `PORT`, `NODE_ENV=production`.
3. **Reverse proxy** — terminate TLS at Caddy/Nginx/Traefik for your domain and proxy to the app port. Set `TRUST_PROXY=true` so the app sees `https` and real client IPs (login rate limiting, bank-callback URL derivation).
4. **Run it** — `docker compose up -d`, or `npm run build && npm start`.
5. **Enable Banking (first setup or after moving)** — production applications require HTTPS URLs, which is why this lives on the VPS rather than localhost:
   - The app serves `https://<your-domain>/privacy` and `https://<your-domain>/terms` — use these as the privacy/terms URLs when registering the application at enablebanking.com.
   - Register `https://<your-domain>/api/bank/callback` as the application's redirect URL (and set it in Settings → Bank sync, or leave blank with `TRUST_PROXY=true` to derive it).
   - Activate the production application in **restricted mode** ("Activate by linking accounts") and link every bank account you intend to sync — unlinked accounts are silently stripped from API responses.
   - Bank connections/consents stored in the DB survive the move unchanged — they are tied to the Enable Banking application, not to the host.

## Domain Rules

xPenditur is a pure cash-flow ledger: no account balance, no carryover between months, no future-dated transactions. Every transaction is categorized; category type must match transaction type.

See **[CONTEXT.md](CONTEXT.md)** for complete semantics (Recurring Transaction backfill, Budget override semantics, Pending Transaction quarantine rules) and **[docs/adr/](docs/adr/)** for architectural decisions.

Key surprises:
- **No future dates** — recurring transactions are for scheduled, not manually-future transactions
- **Category type-matching enforced** — can't use a "spending" category for earnings
- **Non-EUR pending rows quarantined** — you must supply the real EUR amount at approval
- **Monthly net only** — "balance" means this month's earnings minus spendings, resets every month

## Tech Stack

- **Backend** — Node.js, Express, better-sqlite3
- **Frontend** — React (Vite), Tailwind CSS, Recharts
- **Deployment** — Docker Compose (single container, volumes for data)
- **Currency** — EUR throughout (amounts in cents, displayed as €XX.XX)
- **Auth** — Single-user JWT (httpOnly cookie)
