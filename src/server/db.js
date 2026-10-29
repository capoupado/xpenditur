import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'xPenditur.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('earning', 'spending', 'both')),
  icon TEXT,
  color TEXT,
  is_system INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recurring_transactions (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('earning', 'spending')),
  amount INTEGER NOT NULL,
  description TEXT,
  category_id INTEGER REFERENCES categories(id),
  frequency TEXT NOT NULL CHECK(frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  day_of_month INTEGER,
  day_of_week INTEGER,
  week_of_month INTEGER,
  next_due DATE NOT NULL,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('earning', 'spending')),
  amount INTEGER NOT NULL,
  description TEXT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  date DATE NOT NULL,
  recurring_id INTEGER REFERENCES recurring_transactions(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY,
  category_id INTEGER REFERENCES categories(id),
  amount INTEGER NOT NULL,
  month TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category_id, month)
);

CREATE UNIQUE INDEX IF NOT EXISTS budgets_one_default_per_category
  ON budgets(category_id) WHERE month IS NULL;

CREATE TABLE IF NOT EXISTS pending_transactions (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('earning', 'spending')),
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  description TEXT,
  suggested_category_id INTEGER NOT NULL REFERENCES categories(id),
  date DATE NOT NULL,
  source_label TEXT,
  source_kind TEXT,
  raw_extracted_json TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Keys already fed into the Pending queue, per source (-1 bank sync,
-- 0 statement file import) — see services/import-dedup.js.
CREATE TABLE IF NOT EXISTS import_dedup (
  source INTEGER NOT NULL,
  dedup_key TEXT NOT NULL,
  processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source, dedup_key)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_connections (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  aspsp_name TEXT NOT NULL,
  aspsp_country TEXT NOT NULL,
  valid_until DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY,
  connection_id INTEGER NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  iban TEXT,
  name TEXT,
  currency TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_sync DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Short-lived one-per-auth rows tracking an in-flight Enable Banking consent
-- flow (the state we sent to POST /auth, awaiting the bank's redirect back).
CREATE TABLE IF NOT EXISTS bank_auth_requests (
  state TEXT PRIMARY KEY,
  aspsp_name TEXT NOT NULL,
  aspsp_country TEXT NOT NULL,
  return_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

function tableHasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

// Column/table upgrades for databases created by an earlier schema. Each step
// is guarded by a schema check so running on a fresh or already-upgraded DB is
// a no-op.
function migrateExisting() {
  if (!tableHasColumn('recurring_transactions', 'week_of_month')) {
    db.exec('ALTER TABLE recurring_transactions ADD COLUMN week_of_month INTEGER');
  }
  if (tableHasColumn('pending_transactions', 'source_email_subject')) {
    removeEmailIngestion();
  }
}

// Email invoice ingestion (IMAP polling + AI extraction) was removed. Pending
// rows it produced stay as audit history; the mailbox tables, their encrypted
// credentials and the email dedup keys go. SQLite can't drop a column that
// carries a foreign key, so pending_transactions is rebuilt without
// account_id (→ imap_accounts), renaming the source_email_* columns that bank
// sync and file import reuse. The old processed_emails table becomes
// import_dedup, keeping only the bank (-1) and file-import (0) keys.
function removeEmailIngestion() {
  db.transaction(() => {
    db.exec(`
      DROP TABLE IF EXISTS pending_transactions_new;
      CREATE TABLE pending_transactions_new (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('earning', 'spending')),
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        description TEXT,
        suggested_category_id INTEGER NOT NULL REFERENCES categories(id),
        date DATE NOT NULL,
        source_label TEXT,
        source_kind TEXT,
        raw_extracted_json TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
        transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO pending_transactions_new (id, type, amount, currency, description,
          suggested_category_id, date, source_label, source_kind, raw_extracted_json,
          status, transaction_id, created_at)
        SELECT id, type, amount, currency, description,
          suggested_category_id, date, source_email_subject,
          CASE WHEN source_email_from IN ('file-import', 'bank-sync') THEN source_email_from ELSE 'email' END,
          raw_extracted_json, status, transaction_id, created_at
        FROM pending_transactions;
      DROP TABLE pending_transactions;
      ALTER TABLE pending_transactions_new RENAME TO pending_transactions;
    `);
    const hasProcessedEmails = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'processed_emails'")
      .get();
    if (hasProcessedEmails && tableHasColumn('processed_emails', 'account_id')) {
      db.exec(`
        INSERT OR IGNORE INTO import_dedup (source, dedup_key, processed_at)
          SELECT account_id, message_id, processed_at FROM processed_emails WHERE account_id <= 0;
      `);
    }
    db.exec(`
      DROP TABLE IF EXISTS processed_emails;
      DROP TABLE IF EXISTS imap_accounts;
      DELETE FROM settings WHERE key LIKE 'imap%';
    `);
  })();
  console.log('[db] Removed email ingestion tables (pending history kept).');
}

function migrate() {
  db.exec(SCHEMA);
  migrateExisting();
}

const DEFAULT_CATEGORIES = [
  { name: 'Salary', type: 'earning', icon: '💰', color: '#22c55e' },
  { name: 'Freelance', type: 'earning', icon: '🧑‍💻', color: '#10b981' },
  { name: 'Food', type: 'spending', icon: '🍔', color: '#f97316' },
  { name: 'Rent', type: 'spending', icon: '🏠', color: '#ef4444' },
  { name: 'Utilities', type: 'spending', icon: '💡', color: '#eab308' },
  { name: 'Transport', type: 'spending', icon: '🚗', color: '#3b82f6' },
  { name: 'Entertainment', type: 'spending', icon: '🎬', color: '#a855f7' },
  { name: 'Health', type: 'spending', icon: '💊', color: '#ec4899' },
  { name: 'Subscriptions', type: 'spending', icon: '📱', color: '#06b6d4' },
  { name: 'Other', type: 'both', icon: '📦', color: '#6b7280', is_system: 1 },
];

function seedCategories() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (count > 0) return;
  const insert = db.prepare(
    'INSERT INTO categories (name, type, icon, color, is_system) VALUES (@name, @type, @icon, @color, @is_system)'
  );
  const insertMany = db.transaction((cats) => {
    for (const cat of cats) {
      insert.run({ is_system: 0, ...cat });
    }
  });
  insertMany(DEFAULT_CATEGORIES);
}

function seedUser() {
  const { DEFAULT_USERNAME, DEFAULT_PASSWORD, RESET_PASSWORD } = process.env;
  const existing = db.prepare('SELECT * FROM users LIMIT 1').get();

  if (!existing) {
    if (!DEFAULT_USERNAME || !DEFAULT_PASSWORD) {
      console.warn(
        '[db] No user exists and DEFAULT_USERNAME/DEFAULT_PASSWORD are not set. Set them in .env and restart.'
      );
      return;
    }
    const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 12);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
      DEFAULT_USERNAME,
      hash
    );
    console.log(`[db] Seeded first user "${DEFAULT_USERNAME}" from env vars.`);
    return;
  }

  if (String(RESET_PASSWORD).toLowerCase() === 'true') {
    if (!DEFAULT_PASSWORD) {
      console.warn('[db] RESET_PASSWORD=true but DEFAULT_PASSWORD is not set. Skipping reset.');
      return;
    }
    const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
    console.warn(
      `[db] RESET_PASSWORD=true — password for "${existing.username}" reset to DEFAULT_PASSWORD. ` +
        'IMPORTANT: set RESET_PASSWORD=false in your .env now, otherwise it will reset again on next boot.'
    );
  }
}

export function initDb() {
  migrate();
  seedCategories();
  seedUser();
  return db;
}

export default db;
