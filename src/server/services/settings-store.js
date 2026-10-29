// Central registry + accessor for the `settings` key/value table.
//
// Some settings (AI provider keys, the Enable Banking private key) must be
// encrypted at rest (see .env.example → ENCRYPTION_KEY). Every setting is
// declared once in SETTINGS_REGISTRY with per-key `validate` / `mask` /
// `encrypt` behaviour, and all reads/writes go through the helpers below
// rather than raw SQL.

import crypto from 'crypto';
import db from '../db.js';
import { AI_PROVIDER_IDS } from './ai-providers.js';

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

// Free-form settings (secrets, ids)
// accept any string — presence/absence is the only thing that matters.
function validateAnyString(value) {
  return typeof value === 'string';
}

// Masks a secret-ish value, showing only its last `visible` characters.
// Dot count is capped so a multiline secret (e.g. a PEM key) stays displayable.
export function maskValue(value, visible = 8) {
  if (!value) return '';
  if (value.length <= visible) return '•'.repeat(value.length);
  return '•'.repeat(Math.min(24, Math.max(4, value.length - visible))) + value.slice(-visible).replace(/\s+/g, ' ');
}

// Registry of every known settings key. `validate(value)` runs on PUT (value
// is always a string or '' at this point); `mask` controls whether GET
// returns a masked preview instead of the raw value; `encrypt` marks values
// that must be AES-encrypted at rest using ENCRYPTION_KEY (ai_key_<provider>).
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
  unusual_spending_alerts: {
    validate: (v) => v === '0' || v === '1',
    validateMessage: 'must be 0 or 1',
    mask: false,
    encrypt: false,
    default: '1',
  },
  // ---- Automation: what happens to freshly synced/imported pending rows ----
  auto_categorize: {
    validate: (v) => v === '0' || v === '1',
    validateMessage: 'must be 0 or 1',
    mask: false,
    encrypt: false,
    default: '1',
  },
  auto_approve: {
    validate: (v) => v === '0' || v === '1',
    validateMessage: 'must be 0 or 1',
    mask: false,
    encrypt: false,
    default: '1',
  },
  auto_approve_min_confidence: {
    validate: (v) => Number.isInteger(Number(v)) && Number(v) >= 50 && Number(v) <= 100,
    validateMessage: 'must be an integer between 50 and 100',
    mask: false,
    encrypt: false,
    default: '80',
  },
  // ---- AI provider (see services/ai-providers.js) ----
  // The active provider is chosen here; each provider keeps its own key and
  // model (generated ai_key_<id> / ai_model_<id> entries below), so switching
  // back and forth doesn't require re-entering anything.
  ai_provider: {
    validate: (v) => v === '' || AI_PROVIDER_IDS.includes(v),
    validateMessage: `must be one of: ${AI_PROVIDER_IDS.join(', ')}`,
    mask: false,
    encrypt: false,
    default: '',
  },
  ai_custom_base_url: {
    validate: (v) => v === '' || /^https?:\/\/.+/.test(v),
    validateMessage: 'must be an http(s) URL (e.g. http://localhost:11434/v1), or empty to clear',
    mask: false,
    encrypt: false,
    default: '',
  },
  ...Object.fromEntries(
    AI_PROVIDER_IDS.flatMap((id) => [
      [`ai_key_${id}`, { validate: validateAnyString, validateMessage: 'must be a string', mask: true, encrypt: true, default: '' }],
      [`ai_model_${id}`, { validate: validateAnyString, validateMessage: 'must be a string', mask: false, encrypt: false, default: '' }],
    ])
  ),
  // ---- Bank sync (Enable Banking PSD2 aggregator) ----
  // Credentials come from a registered application at enablebanking.com:
  // the application ID becomes the JWT `kid`, the RSA private key signs it.
  enablebanking_app_id: {
    validate: validateAnyString,
    validateMessage: 'must be a string',
    mask: false,
    encrypt: false,
    default: '',
  },
  enablebanking_private_key: {
    validate: (v) => v === '' || (typeof v === 'string' && v.includes('PRIVATE KEY')),
    validateMessage: 'must be a PEM private key (-----BEGIN PRIVATE KEY----- ...), or empty to clear',
    mask: true,
    encrypt: true,
    default: '',
  },
  // Must exactly match a redirect URL registered on the Enable Banking
  // application. Empty → derived from the request host at connect time.
  enablebanking_redirect_url: {
    validate: (v) => v === '' || /^https?:\/\/.+/.test(v),
    validateMessage: 'must be an http(s) URL (e.g. http://localhost:3000/api/bank/callback), or empty to derive it automatically',
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

/**
 * One-time startup migration from the single-provider era: a stored
 * deepseek_api_key becomes the DeepSeek provider's key (same ciphertext — the
 * encryption is identical), and DeepSeek becomes the active provider with the
 * model that was previously hardcoded. Idempotent.
 */
export function migrateLegacyDeepseekSetting() {
  const legacy = db.prepare("SELECT value FROM settings WHERE key = 'deepseek_api_key'").get();
  if (!legacy) return;
  const upsertIfMissing = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  db.transaction(() => {
    if (legacy.value) {
      upsertIfMissing.run('ai_key_deepseek', legacy.value);
      upsertIfMissing.run('ai_model_deepseek', 'deepseek-chat');
      upsertIfMissing.run('ai_provider', 'deepseek');
    }
    db.prepare("DELETE FROM settings WHERE key = 'deepseek_api_key'").run();
  })();
  if (legacy.value) console.log('[settings] Migrated DeepSeek API key to the AI provider settings.');
}


export default {
  SETTINGS_REGISTRY,
  migrateLegacyDeepseekSetting,
  getSetting,
  getSettingNumber,
  setSetting,
  getAllSettingsForDisplay,
  maskValue,
  checkEncryptedSettingsDecryptable,
};
