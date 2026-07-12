// Multiple IMAP mailboxes — CRUD over the imap_accounts table, plus the
// one-time migration of the legacy single-inbox imap_* settings keys.
//
// Passwords are AES-256-GCM encrypted at rest with the same ENCRYPTION_KEY
// scheme as encrypted settings values (settings-store.js). API-facing reads
// only ever expose a masked preview; decryption happens solely when the poller
// or connection test needs a live config.

import db from '../db.js';
import { encryptValue, decryptValue, maskValue } from './settings-store.js';

function validationError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// Validates and normalises account input. `partial` (edits) skips absent
// fields; on create everything except allowlist/tls/port is required.
function normalizeInput(body, { partial = false } = {}) {
  const out = {};

  if (!partial || body.label !== undefined) {
    if (typeof body.label !== 'string' || !body.label.trim()) {
      throw validationError('label is required (a short name like "Gmail" or "Zoho")');
    }
    out.label = body.label.trim();
  }
  if (!partial || body.host !== undefined) {
    if (typeof body.host !== 'string' || !body.host.trim()) {
      throw validationError('host is required (e.g. imap.gmail.com)');
    }
    out.host = body.host.trim();
  }
  if (body.port !== undefined && body.port !== '') {
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw validationError('port must be an integer 1-65535 (typically 993 for IMAPS)');
    }
    out.port = port;
  } else if (!partial) {
    out.port = 993;
  }
  if (!partial || body.username !== undefined) {
    if (typeof body.username !== 'string' || !body.username.trim()) {
      throw validationError('username is required (usually the full email address)');
    }
    out.username = body.username.trim();
  }
  // Password: required on create; on edit an absent/empty value means "keep".
  if (typeof body.password === 'string' && body.password.trim()) {
    out.password = encryptValue(body.password.trim());
  } else if (!partial) {
    throw validationError('password is required (use an app password for Gmail/Zoho)');
  }
  if (body.tls !== undefined) {
    out.tls = body.tls === false || body.tls === 'false' || body.tls === 0 ? 0 : 1;
  } else if (!partial) {
    out.tls = 1;
  }
  if (body.sender_allowlist !== undefined) {
    if (typeof body.sender_allowlist !== 'string') {
      throw validationError('sender_allowlist must be a string (comma/newline separated, or empty)');
    }
    out.sender_allowlist = body.sender_allowlist;
  } else if (!partial) {
    out.sender_allowlist = '';
  }
  if (body.active !== undefined) {
    out.active = body.active === false || body.active === 'false' || body.active === 0 ? 0 : 1;
  }

  return out;
}

// API-facing shape: never the password, only a masked preview of it.
function forDisplay(row) {
  if (!row) return null;
  const { password, ...rest } = row;
  let preview = '';
  try {
    preview = maskValue(decryptValue(password));
  } catch {
    preview = '(undecryptable — re-enter the password)';
  }
  return { ...rest, password_masked: preview };
}

export function listAccounts() {
  return db.prepare('SELECT * FROM imap_accounts ORDER BY id ASC').all().map(forDisplay);
}

export function getAccountRow(id) {
  return db.prepare('SELECT * FROM imap_accounts WHERE id = ?').get(id);
}

export function getAccountForDisplay(id) {
  return forDisplay(getAccountRow(id));
}

/**
 * Decrypted connection config for the poller / connection test, or null when
 * the password can't be decrypted (ENCRYPTION_KEY changed).
 */
export function accountConfig(row) {
  try {
    return {
      id: row.id,
      label: row.label,
      host: row.host,
      port: row.port,
      user: row.username,
      password: decryptValue(row.password),
      secure: row.tls !== 0,
      senderAllowlist: row.sender_allowlist || '',
      lastPoll: row.last_poll || null,
    };
  } catch (err) {
    console.error(
      `[imap-accounts] Cannot decrypt password for account "${row.label}" (id ${row.id}) — ` +
        'ENCRYPTION_KEY may have changed. Re-enter it in Settings. (' + err.message + ')'
    );
    return null;
  }
}

export function listActiveAccountConfigs() {
  return db
    .prepare('SELECT * FROM imap_accounts WHERE active = 1 ORDER BY id ASC')
    .all()
    .map(accountConfig)
    .filter(Boolean);
}

export function createAccount(body) {
  const fields = normalizeInput(body);
  const info = db
    .prepare(
      `INSERT INTO imap_accounts (label, host, port, username, password, tls, sender_allowlist, active)
       VALUES (@label, @host, @port, @username, @password, @tls, @sender_allowlist, 1)`
    )
    .run(fields);
  return getAccountForDisplay(info.lastInsertRowid);
}

export function updateAccount(id, body) {
  const existing = getAccountRow(id);
  if (!existing) return null;
  const fields = normalizeInput(body, { partial: true });
  const merged = { ...existing, ...fields };
  db.prepare(
    `UPDATE imap_accounts
       SET label = @label, host = @host, port = @port, username = @username,
           password = @password, tls = @tls, sender_allowlist = @sender_allowlist, active = @active
     WHERE id = @id`
  ).run(merged);
  return getAccountForDisplay(id);
}

export function deleteAccount(id) {
  const existing = getAccountRow(id);
  if (!existing) return false;
  // Dedup history is meaningless without its account; pending rows keep their
  // audit trail (account_id FK is ON DELETE SET NULL).
  db.prepare('DELETE FROM processed_emails WHERE account_id = ?').run(id);
  db.prepare('DELETE FROM imap_accounts WHERE id = ?').run(id);
  return true;
}

export function updateLastPoll(id, iso) {
  db.prepare('UPDATE imap_accounts SET last_poll = ? WHERE id = ?').run(iso, id);
}

// Legacy settings keys that predate the imap_accounts table.
const LEGACY_KEYS = [
  'imap_host',
  'imap_port',
  'imap_user',
  'imap_password',
  'imap_tls',
  'imap_sender_allowlist',
  'imap_last_poll',
];

/**
 * One-time startup migration: if the legacy single-inbox imap_* settings hold
 * a complete configuration and no accounts exist yet, move it into
 * imap_accounts row 1 (matching the account_id the processed_emails rebuild
 * assumed) and delete the legacy keys. The stored password ciphertext is
 * copied verbatim — same encryption scheme, no decrypt/re-encrypt needed.
 */
export function migrateLegacyImapSettings() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM imap_accounts').get().c;
  const legacy = {};
  for (const key of LEGACY_KEYS) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    legacy[key] = row ? row.value : '';
  }

  if (count === 0 && legacy.imap_host && legacy.imap_user && legacy.imap_password) {
    const port = Number(legacy.imap_port);
    db.prepare(
      `INSERT INTO imap_accounts (label, host, port, username, password, tls, sender_allowlist, active, last_poll)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      legacy.imap_user,
      legacy.imap_host,
      Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 993,
      legacy.imap_user,
      legacy.imap_password,
      legacy.imap_tls === 'false' ? 0 : 1,
      legacy.imap_sender_allowlist || '',
      legacy.imap_last_poll || null
    );
    console.log(`[imap-accounts] Migrated legacy IMAP settings to mailbox account "${legacy.imap_user}".`);
  }

  const del = db.prepare('DELETE FROM settings WHERE key = ?');
  for (const key of LEGACY_KEYS) del.run(key);
}

export default {
  listAccounts,
  getAccountRow,
  getAccountForDisplay,
  accountConfig,
  listActiveAccountConfigs,
  createAccount,
  updateAccount,
  deleteAccount,
  updateLastPoll,
  migrateLegacyImapSettings,
};
