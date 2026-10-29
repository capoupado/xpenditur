// Dedup record for rows fed into the Pending queue. Each source keeps its own
// key space: bank sync keys on the bank's entry reference, statement file
// imports on row content. A key once recorded is never inserted again, so
// re-syncing or re-importing an overlapping window is harmless.

import db from '../db.js';

export function isProcessed(source, key) {
  return !!db.prepare('SELECT 1 FROM import_dedup WHERE source = ? AND dedup_key = ?').get(source, key);
}

export function recordProcessed(source, key) {
  db.prepare('INSERT OR IGNORE INTO import_dedup (source, dedup_key) VALUES (?, ?)').run(source, key);
}
