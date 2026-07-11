// Phase 6 — IMAP polling + email fetching.
//
// Read-only mailbox contract (CONTEXT.md → Read-only mailbox): the poller NEVER
// alters the mailbox — no \Seen, no flags. It opens INBOX read-only and finds
// candidates by a DATE WINDOW (since the last successful poll, minus a 1-day
// overlap; first ever poll → last 7 days), so a user reading their own mail can
// never hide an invoice. Deduplication is solely via the processed_emails table
// keyed on the Message-ID header (falling back to a hash of from+date+subject
// when a message has no Message-ID).
//
// The connection/fetch code lives at the bottom; the decision logic (candidate
// filtering, allow-list, dedup id, body extraction, search window) is factored
// into pure functions above so it can be unit-tested with synthetic messages —
// no live IMAP server required (imapflow offers no easy in-process fake).

import crypto from 'crypto';
import db from '../db.js';
import { getSetting, getSettingNumber } from './settings-store.js';
import { todayLocalDate, addDays } from '../utils/dates.js';
import { extractAndInsertPending } from './invoice-parser.js';

// Case-insensitive subject indicators (plan.md).
export const SUBJECT_KEYWORDS = [
  'invoice',
  'receipt',
  'payment',
  'order confirmation',
  'fatura',
  'recibo',
  'pagamento',
];

const MAX_BODY_CHARS = 15000;

// ---------------------------------------------------------------------------
// Pure decision logic (unit-tested)
// ---------------------------------------------------------------------------

export function subjectMatchesKeywords(subject) {
  if (typeof subject !== 'string' || !subject) return false;
  const lower = subject.toLowerCase();
  return SUBJECT_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Parse the sender allow-list setting (comma/newline/semicolon separated) into
 * a lower-cased array. Empty / whitespace-only → [].
 */
export function parseAllowlist(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Is this sender allowed? An empty allow-list means "no sender filter" → all
 * allowed. Otherwise the from-address must contain one of the allow-list
 * entries (case-insensitive substring, so "billing@shop.com" matches an entry
 * of "shop.com").
 */
export function senderAllowed(fromAddress, allowlist) {
  if (!allowlist || allowlist.length === 0) return true;
  if (typeof fromAddress !== 'string' || !fromAddress) return false;
  const lower = fromAddress.toLowerCase();
  return allowlist.some((entry) => lower.includes(entry));
}

/**
 * A message is a candidate iff its subject matches a keyword AND its sender
 * passes the allow-list.
 */
export function isCandidate(message, allowlist) {
  return subjectMatchesKeywords(message.subject) && senderAllowed(message.from, allowlist);
}

/**
 * Stable dedup key for a message: its Message-ID header if present, else a
 * sha256 hash of from + date + subject (prefixed so it's visibly a fallback).
 */
export function messageIdFor(message) {
  const mid = typeof message.messageId === 'string' ? message.messageId.trim() : '';
  if (mid) return mid;
  const basis = `${message.from || ''}|${message.date || ''}|${message.subject || ''}`;
  return 'sha256:' + crypto.createHash('sha256').update(basis).digest('hex');
}

export function stripHtml(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract usable body text: prefer text/plain; else strip tags from text/html.
 * Capped at MAX_BODY_CHARS so a huge marketing email can't blow up the prompt.
 */
export function extractBodyText({ text, html } = {}) {
  let out = '';
  if (typeof text === 'string' && text.trim()) out = text;
  else if (typeof html === 'string' && html.trim()) out = stripHtml(html);
  if (out.length > MAX_BODY_CHARS) out = out.slice(0, MAX_BODY_CHARS);
  return out.trim();
}

/**
 * Compute the IMAP search "since" date (YYYY-MM-DD) from the persisted
 * last-poll timestamp. First poll (no cursor) → 7 days ago. Otherwise the
 * last-poll date minus a 1-day overlap so a message that arrived moments after
 * the previous poll is never missed.
 */
export function computeSinceDate(lastPollIso, today = todayLocalDate()) {
  if (!lastPollIso) return addDays(today, -7);
  const datePart = String(lastPollIso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return addDays(today, -7);
  return addDays(datePart, -1);
}

// ---------------------------------------------------------------------------
// Dedup helpers (processed_emails is the sole dedup authority)
// ---------------------------------------------------------------------------

export function isProcessed(messageId) {
  return !!db.prepare('SELECT 1 FROM processed_emails WHERE message_id = ?').get(messageId);
}

export function recordProcessed(messageId) {
  db.prepare('INSERT OR IGNORE INTO processed_emails (message_id) VALUES (?)').run(messageId);
}

// ---------------------------------------------------------------------------
// Settings / configuration
// ---------------------------------------------------------------------------

/**
 * Read IMAP connection config from settings. Returns null when incomplete
 * (host/user/password missing) — the poller then becomes a silent no-op.
 */
export function readImapConfig(overrides = {}) {
  const host = overrides.host ?? getSetting('imap_host');
  const user = overrides.user ?? getSetting('imap_user');
  const password = overrides.password ?? getSetting('imap_password');
  const port = Number(overrides.port ?? getSettingNumber('imap_port', 993));
  const tlsRaw = overrides.tls ?? getSetting('imap_tls');
  const secure = tlsRaw === undefined || tlsRaw === null ? true : String(tlsRaw) !== 'false';

  if (!host || !user || !password) return null;
  return { host, port: Number.isFinite(port) ? port : 993, user, password, secure };
}

// ---------------------------------------------------------------------------
// imapflow connection (loaded lazily so unit tests of the pure functions above
// don't require the dependency to be installed/loadable)
// ---------------------------------------------------------------------------

async function connectClient(config) {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
  await client.connect();
  return client;
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

// Flatten an imapflow bodyStructure tree and pick the best text part number.
// Prefers text/plain, else text/html. Returns { part, kind } or null.
export function pickTextPart(structure) {
  const found = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node.childNodes) && node.childNodes.length) {
      node.childNodes.forEach(walk);
      return;
    }
    const type = (node.type || '').toLowerCase();
    if (type === 'text/plain' || type === 'text/html') {
      found.push({ part: node.part || '1', kind: type });
    }
  };
  walk(structure);
  const plain = found.find((f) => f.kind === 'text/plain');
  if (plain) return plain;
  const html = found.find((f) => f.kind === 'text/html');
  return html || null;
}

async function fetchBodyText(client, seq) {
  try {
    const msg = await client.fetchOne(seq, { bodyStructure: true });
    const pick = pickTextPart(msg?.bodyStructure);
    if (!pick) return '';
    const dl = await client.download(seq, pick.part, { uid: false });
    if (!dl || !dl.content) return '';
    const raw = await streamToString(dl.content);
    return pick.kind === 'text/html'
      ? extractBodyText({ html: raw })
      : extractBodyText({ text: raw });
  } catch (err) {
    console.error('[imap] Failed to fetch body (non-fatal):', err.message);
    return '';
  }
}

// ---------------------------------------------------------------------------
// The poll cycle
// ---------------------------------------------------------------------------

/**
 * Run one poll cycle. Connects read-only, searches by date window, filters
 * candidates, dedups via processed_emails, records + extracts each new one.
 * Never throws (connection errors are logged and the cycle is skipped).
 *
 * @returns counts: { examined, matched, extracted, skippedDuplicates, skipped, error? }
 */
export async function pollInbox() {
  const counts = { examined: 0, matched: 0, extracted: 0, skippedDuplicates: 0, skipped: 0 };

  const config = readImapConfig();
  if (!config) {
    // Incomplete settings → silent no-op (documented contract).
    return { ...counts, skipped: 0, noop: true };
  }

  const allowlist = parseAllowlist(getSetting('imap_sender_allowlist'));
  const today = todayLocalDate();
  const sinceDate = computeSinceDate(getSetting('imap_last_poll'), today);

  let client;
  try {
    client = await connectClient(config);
  } catch (err) {
    console.error('[imap] Connection failed (skipping cycle):', err.message);
    return { ...counts, error: err.message };
  }

  try {
    // READ-ONLY open — never mutates flags/seen state.
    await client.mailboxOpen('INBOX', { readOnly: true });

    const uids = await client.search({ since: new Date(`${sinceDate}T00:00:00Z`) }, { uid: true });
    const list = Array.isArray(uids) ? uids : [];

    for (const uid of list) {
      counts.examined++;
      let env;
      try {
        const msg = await client.fetchOne(uid, { envelope: true }, { uid: true });
        env = msg?.envelope;
      } catch (err) {
        console.error('[imap] Failed to fetch envelope (skipping message):', err.message);
        continue;
      }
      if (!env) continue;

      const fromAddr = env.from && env.from[0] ? env.from[0].address || '' : '';
      const message = {
        subject: env.subject || '',
        from: fromAddr,
        date: env.date ? new Date(env.date).toISOString() : '',
        messageId: env.messageId || '',
      };

      if (!isCandidate(message, allowlist)) continue;
      counts.matched++;

      const dedupId = messageIdFor(message);
      if (isProcessed(dedupId)) {
        counts.skippedDuplicates++;
        continue;
      }

      // Record FIRST so the email is deduped whether or not extraction works.
      recordProcessed(dedupId);

      const receivedIso = message.date || new Date().toISOString();
      const receivedDate = receivedIso.slice(0, 10);
      const bodyText = await fetchBodyText(client, uid);

      const result = await extractAndInsertPending({
        subject: message.subject,
        from: message.from,
        receivedAt: receivedIso,
        receivedDate,
        bodyText,
      });
      if (result.inserted) counts.extracted++;
      else counts.skipped++;
    }

    // Advance the cursor only on a fully successful cycle.
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('imap_last_poll', new Date().toISOString());
  } catch (err) {
    console.error('[imap] Poll cycle failed:', err.message);
    counts.error = err.message;
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }

  return counts;
}

/**
 * Attempt a connection + read-only mailbox open with current (or provided)
 * settings. Used by POST /api/settings/test-imap. Never throws.
 */
export async function testImapConnection(overrides = {}) {
  const config = readImapConfig(overrides);
  if (!config) {
    return { success: false, error: 'IMAP settings are incomplete (host, user and password are required).' };
  }
  let client;
  try {
    client = await connectClient(config);
    await client.mailboxOpen('INBOX', { readOnly: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
    }
  }
}

export default {
  SUBJECT_KEYWORDS,
  subjectMatchesKeywords,
  parseAllowlist,
  senderAllowed,
  isCandidate,
  messageIdFor,
  stripHtml,
  extractBodyText,
  computeSinceDate,
  isProcessed,
  recordProcessed,
  readImapConfig,
  pickTextPart,
  pollInbox,
  testImapConnection,
};
