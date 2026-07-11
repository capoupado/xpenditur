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
  transaction_id INTEGER REFERENCES transactions(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processed_emails (
  message_id TEXT PRIMARY KEY,
  processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function migrate() {
  db.exec(SCHEMA);
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
