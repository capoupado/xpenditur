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
  source_email_subject TEXT,
  source_email_from TEXT,
  source_email_date DATETIME,
  raw_extracted_json TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES imap_accounts(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS imap_accounts (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 993,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  tls INTEGER NOT NULL DEFAULT 1,
  sender_allowlist TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  last_poll DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processed_emails (
  account_id INTEGER NOT NULL DEFAULT 1,
  message_id TEXT NOT NULL,
  processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, message_id)
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
// is guarded by a pragma check so running on a fresh or already-upgraded DB is
// a no-op. (SQLite ALTER TABLE can only ADD COLUMN; the processed_emails PK
// change needs a rebuild.)
function migrateExisting() {
  if (!tableHasColumn('recurring_transactions', 'week_of_month')) {
    db.exec('ALTER TABLE recurring_transactions ADD COLUMN week_of_month INTEGER');
  }
  if (!tableHasColumn('pending_transactions', 'account_id')) {
    db.exec('ALTER TABLE pending_transactions ADD COLUMN account_id INTEGER REFERENCES imap_accounts(id) ON DELETE SET NULL');
  }
  const pendingTxFk = db
    .prepare('PRAGMA foreign_key_list(pending_transactions)')
    .all()
    .find((fk) => fk.from === 'transaction_id');
  if (pendingTxFk && pendingTxFk.on_delete === 'NO ACTION') {
    // transaction_id originally had no ON DELETE action, which blocked deleting
    // any transaction created by approving a pending item. SQLite can't alter
    // an existing FK, so rebuild the table with ON DELETE SET NULL. Runs after
    // the account_id ADD COLUMN above, so that column is always present here.
    db.exec(`
      CREATE TABLE pending_transactions_new (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('earning', 'spending')),
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        description TEXT,
        suggested_category_id INTEGER NOT NULL REFERENCES categories(id),
        date DATE NOT NULL,
        source_email_subject TEXT,
        source_email_from TEXT,
        source_email_date DATETIME,
        raw_extracted_json TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
        transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
        account_id INTEGER REFERENCES imap_accounts(id) ON DELETE SET NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO pending_transactions_new (id, type, amount, currency, description,
          suggested_category_id, date, source_email_subject, source_email_from,
          source_email_date, raw_extracted_json, status, transaction_id, account_id, created_at)
        SELECT id, type, amount, currency, description,
          suggested_category_id, date, source_email_subject, source_email_from,
          source_email_date, raw_extracted_json, status, transaction_id, account_id, created_at
        FROM pending_transactions;
      DROP TABLE pending_transactions;
      ALTER TABLE pending_transactions_new RENAME TO pending_transactions;
    `);
  }
  if (!tableHasColumn('processed_emails', 'account_id')) {
    // Rebuild with a composite (account_id, message_id) key. Existing rows all
    // came from the legacy single inbox, which the settings→imap_accounts
    // migration inserts as account id 1 — so default them to 1.
    db.exec(`
      CREATE TABLE processed_emails_new (
        account_id INTEGER NOT NULL DEFAULT 1,
        message_id TEXT NOT NULL,
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (account_id, message_id)
      );
      INSERT INTO processed_emails_new (account_id, message_id, processed_at)
        SELECT 1, message_id, processed_at FROM processed_emails;
      DROP TABLE processed_emails;
      ALTER TABLE processed_emails_new RENAME TO processed_emails;
    `);
  }
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
