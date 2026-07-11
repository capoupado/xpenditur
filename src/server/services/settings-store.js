// Central registry + accessor for the `settings` key/value table.
//
// Phase 5 only needs plaintext Discord/notification settings, but Phase 6 will
// add IMAP credentials and a DeepSeek API key — some of which must be
// encrypted at rest (see plan.md → Security, CONTEXT.md, .env.example →
// ENCRYPTION_KEY). To avoid a rework then, every setting is declared once in
// SETTINGS_REGISTRY with per-key `validate` / `mask` / `encrypt` behaviour, and
// all reads/writes go through the helpers below rather than raw SQL. Adding a
// Phase 6 key is then just one more registry entry.

import crypto from 'crypto';
import db from '../db.js';

const DISCORD_WEBHOOK_RE = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/.+/;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function validateDiscordWebhook(value) {
  if (value === '' || value === null || value === undefined) return true; // empty clears it
  return isNonEmptyString(value) && DISCORD_WEBHOOK_RE.test(value);
}

function validateThreshold(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 100;
}

function validateWeekday(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 6;
}

// Phase 6 validators. Empty string is always accepted (it clears the value /
// keeps a secret unset); non-empty values are checked for shape.
function validatePort(value) {
  if (value === '') return true;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function validateBoolish(value) {
  return value === '' || value === 'true' || value === 'false';
}

function validatePollInterval(value) {
  if (value === '') return true;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 1440; // 1 min .. 1 day
}

// Free-form settings (host, username, allow-list, secrets, internal cursors)
// accept any string — presence/absence is the only thing that matters.
function validateAnyString(value) {
  return typeof value === 'string';
}

// Masks a secret-ish value, showing only its last `visible` characters.
export function maskValue(value, visible = 8) {
  if (!value) return '';
  if (value.length <= visible) return '•'.repeat(value.length);
  return '•'.repeat(Math.max(4, value.length - visible)) + value.slice(-visible);
}

// Registry of every known settings key. `validate(value)` runs on PUT (value
// is always a string or '' at this point); `mask` controls whether GET
// returns a masked preview instead of the raw value; `encrypt` marks values
// that must be AES-encrypted at rest using ENCRYPTION_KEY (none yet in Phase
// 5 — Phase 6's imap_password / deepseek_api_key will set this true).
export const SETTINGS_REGISTRY = {
  discord_webhook_url: {
    validate: validateDiscordWebhook,
    validateMessage: 'must be a https://discord.com/api/webhooks/... (or discordapp.com) URL, or empty to clear',
    mask: true,
    encrypt: false,
    default: '',
  },
  notification_budget_threshold: {
    validate: validateThreshold,
    validateMessage: 'must be an integer between 1 and 99',
    mask: false,
    encrypt: false,
    default: '80',
  },
  weekly_summary_day: {
    validate: validateWeekday,
    validateMessage: 'must be an integer 0 (Sunday) to 6 (Saturday)',
    mask: false,
    encrypt: false,
    default: '1',
  },
  // ---- Phase 6 — Email invoice auto-tracking (IMAP + DeepSeek) ----
  imap_host: {
    validate: validateAnyString,
    validateMessage: 'must be a string',
    mask: false,
    encrypt: false,
    default: '',
  },
  imap_port: {
    validate: validatePort,
    validateMessage: 'must be an integer 1-65535 (typically 993 for IMAPS)',
    mask: false,
    encrypt: false,
    default: '993',
  },
  imap_user: {
    validate: validateAnyString,
    validateMessage: 'must be a string',
    mask: false,
    encrypt: false,
    default: '',
  },
  imap_password: {
    validate: validateAnyString,
    validateMessage: 'must be a string',
    mask: true,
    encrypt: true,
    default: '',
  },
  imap_tls: {
    validate: validateBoolish,
    validateMessage: "must be 'true' or 'false'",
    mask: false,
    encrypt: false,
    default: 'true',
  },
  imap_poll_interval_minutes: {
    validate: validatePollInterval,
    validateMessage: 'must be an integer number of minutes between 1 and 1440',
    mask: false,
    encrypt: false,
    default: '15',
  },
  imap_sender_allowlist: {
    validate: validateAnyString,
    validateMessage: 'must be a string (comma/newline separated addresses, or empty)',
    mask: false,
    encrypt: false,
    default: '',
  },
  deepseek_api_key: {
    validate: validateAnyString,
    validateMessage: 'must be a string',
    mask: true,
    encrypt: true,
    default: '',
  },
  // Internal cursor: ISO timestamp of the last successful IMAP poll. Not a
  // user-facing setting (the Settings UI ignores it), but stored here so the
  // poller's date-window survives restarts. Registered so it goes through the
  // same get/setSetting plumbing.
  imap_last_poll: {
    validate: validateAnyString,
    validateMessage: 'must be a string',
    mask: false,
    encrypt: false,
    default: '',
  },
};

function encrypt(plain) {
  const key = crypto.createHash('sha256').update(String(process.env.ENCRYPTION_KEY || '')).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), authTag.toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(stored) {
  const [version, ivB64, tagB64, dataB64] = String(stored).split(':');
  if (version !== 'v1') throw new Error('Unknown encrypted settings value format');
  const key = crypto.createHash('sha256').update(String(process.env.ENCRYPTION_KEY || '')).digest();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

/**
 * Raw read of a single setting's decrypted/plaintext value, or `fallback`
 * (defaulting to the registry default, else null) if unset.
 */
export function getSetting(key, fallback) {
  const meta = SETTINGS_REGISTRY[key];
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback !== undefined ? fallback : meta?.default ?? null;
  if (meta?.encrypt && row.value) {
    try {
      return decrypt(row.value);
    } catch (err) {
      console.error(
        `[settings] Failed to decrypt "${key}" — ENCRYPTION_KEY may have changed. ` +
          'Re-enter this value in Settings. (' + err.message + ')'
      );
      return fallback !== undefined ? fallback : null;
    }
  }
  return row.value;
}

export function getSettingNumber(key, fallback) {
  const raw = getSetting(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Validates and upserts a single setting. Throws with a friendly message on
 * invalid input; caller (routes/settings.js) turns that into a 400.
 */
export function setSetting(key, value) {
  const meta = SETTINGS_REGISTRY[key];
  if (!meta) {
    const err = new Error(`Unknown setting key: ${key}`);
    err.status = 400;
    throw err;
  }
  const strValue = value === null || value === undefined ? '' : String(value);
  if (meta.validate && !meta.validate(strValue)) {
    const err = new Error(`Invalid value for "${key}": ${meta.validateMessage || 'failed validation'}`);
    err.status = 400;
    throw err;
  }
  const toStore = meta.encrypt && strValue ? encrypt(strValue) : strValue;
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, toStore);
}

/**
 * Returns every registered setting for GET /api/settings, masking values
 * flagged `mask: true` in the registry.
 */
export function getAllSettingsForDisplay() {
  const out = {};
  for (const [key, meta] of Object.entries(SETTINGS_REGISTRY)) {
    const value = getSetting(key, meta.default ?? '');
    out[key] = meta.mask ? maskValue(value) : value;
  }
  return out;
}

/**
 * Boot-time sanity check for encrypted secrets. If ENCRYPTION_KEY changed
 * since a secret was stored, decryption fails; rather than surfacing an opaque
 * crypto error later, log one clear, actionable line per affected key. The
 * secret is then treated as unset everywhere (getSetting already returns the
 * fallback on decrypt failure). Safe to call once on startup.
 */
export function checkEncryptedSettingsDecryptable() {
  for (const [key, meta] of Object.entries(SETTINGS_REGISTRY)) {
    if (!meta.encrypt) continue;
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row || !row.value) continue;
    try {
      decrypt(row.value);
    } catch {
      console.error(
        `[settings] "${key}" could not be decrypted — ENCRYPTION_KEY changed. ` +
          'Re-enter this credential in Settings. Treating it as unset for now.'
      );
    }
  }
}

export default {
  SETTINGS_REGISTRY,
  getSetting,
  getSettingNumber,
  setSetting,
  getAllSettingsForDisplay,
  maskValue,
  checkEncryptedSettingsDecryptable,
};
