// Phase 6 — IMAP polling + email fetching.
//
// Read-only mailbox contract (CONTEXT.md → Read-only mailbox): the poller NEVER
// alters the mailbox — no \Seen, no flags. It opens INBOX read-only and finds
// candidates by a DATE WINDOW (since the last successful poll, minus a 1-day
// overlap; first ever poll → last 7 days), so a user reading their own mail can
// never hide an invoice. A manual backfill can instead search an explicit
// fromDate..toDate window without touching the incremental cursor.
// Deduplication is solely via the processed_emails table
// keyed on the Message-ID header (falling back to a hash of from+date+subject
// when a message has no Message-ID).
//
// The connection/fetch code lives at the bottom; the decision logic (candidate
// filtering, allow-list, dedup id, body extraction, search window) is factored
// into pure functions above so it can be unit-tested with synthetic messages —
// no live IMAP server required (imapflow offers no easy in-process fake).

import crypto from 'crypto';
import db from '../db.js';
import { todayLocalDate, addDays } from '../utils/dates.js';
import { extractAndInsertPending } from './invoice-parser.js';
import { listActiveAccountConfigs, updateLastPoll } from './imap-accounts.js';

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
// Dedup helpers (processed_emails is the sole dedup authority, per account —
// the same Message-ID arriving in two mailboxes is tracked independently)
// ---------------------------------------------------------------------------

export function isProcessed(accountId, messageId) {
  return !!db
    .prepare('SELECT 1 FROM processed_emails WHERE account_id = ? AND message_id = ?')
    .get(accountId, messageId);
}

export function recordProcessed(accountId, messageId) {
  db.prepare('INSERT OR IGNORE INTO processed_emails (account_id, message_id) VALUES (?, ?)').run(
    accountId,
    messageId
  );
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

async function fetchBodyText(client, uid) {
  try {
    const msg = await client.fetchOne(uid, { bodyStructure: true }, { uid: true });
    const pick = pickTextPart(msg?.bodyStructure);
    if (!pick) return '';
    const dl = await client.download(uid, pick.part, { uid: true });
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
 * Poll a single account. Connects read-only, searches by date window, filters
 * candidates, dedups via processed_emails, records + extracts each new one.
 * Never throws (connection errors are logged and the cycle is skipped).
 *
 * @param config decrypted account config from imap-accounts.js
 * @param range  optional { fromDate, toDate } (YYYY-MM-DD, inclusive) for a
 *               manual backfill poll. A ranged poll searches exactly that
 *               window and NEVER advances the account's last_poll cursor, so
 *               the regular incremental polling is unaffected.
 * @returns counts: { account, examined, matched, extracted, skippedDuplicates, skipped, error? }
 */
export async function pollAccount(config, range = null) {
  const counts = {
    account: config.label,
    examined: 0,
    matched: 0,
    extracted: 0,
    skippedDuplicates: 0,
    skipped: 0,
  };

  const allowlist = parseAllowlist(config.senderAllowlist);
  const today = todayLocalDate();
  const sinceDate = range ? range.fromDate : computeSinceDate(config.lastPoll, today);

  let client;
  try {
    client = await connectClient(config);
  } catch (err) {
    console.error(`[imap] Connection failed for "${config.label}" (skipping cycle):`, err.message);
    return { ...counts, error: err.message };
  }

  try {
    // READ-ONLY open — never mutates flags/seen state.
    await client.mailboxOpen('INBOX', { readOnly: true });

    // IMAP BEFORE is exclusive and date-granular, so an inclusive toDate means
    // BEFORE toDate+1.
    const criteria = { since: new Date(`${sinceDate}T00:00:00Z`) };
    if (range) criteria.before = new Date(`${addDays(range.toDate, 1)}T00:00:00Z`);
    const uids = await client.search(criteria, { uid: true });
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
      if (isProcessed(config.id, dedupId)) {
        counts.skippedDuplicates++;
        continue;
      }

      // Record FIRST so the email is deduped whether or not extraction works.
      recordProcessed(config.id, dedupId);

      const receivedIso = message.date || new Date().toISOString();
      const receivedDate = receivedIso.slice(0, 10);
      const bodyText = await fetchBodyText(client, uid);
      if (!bodyText) {
        // An empty prompt only produces hallucinated extractions — don't call
        // the AI provider at all.
        console.error(`[imap] Empty body for "${message.subject}" — skipping extraction.`);
        counts.skipped++;
        continue;
      }

      const result = await extractAndInsertPending({
        subject: message.subject,
        from: message.from,
        receivedAt: receivedIso,
        receivedDate,
        bodyText,
        accountId: config.id,
      });
      if (result.inserted) counts.extracted++;
      else counts.skipped++;
    }

    // Advance this account's cursor only on a fully successful REGULAR cycle —
    // a manual ranged backfill must not disturb incremental polling.
    if (!range) updateLastPoll(config.id, new Date().toISOString());
  } catch (err) {
    console.error(`[imap] Poll cycle failed for "${config.label}":`, err.message);
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
 * Poll every active mailbox account in sequence. Returns aggregate counts plus
 * a per-account breakdown. No accounts configured → { noop: true }.
 * Pass `range` ({ fromDate, toDate }) for a manual backfill over that window.
 */
export async function pollAllInboxes(range = null) {
  const configs = listActiveAccountConfigs();
  if (configs.length === 0) {
    return { examined: 0, matched: 0, extracted: 0, skippedDuplicates: 0, skipped: 0, noop: true };
  }

  const accounts = [];
  for (const config of configs) {
    accounts.push(await pollAccount(config, range));
  }

  const totals = { examined: 0, matched: 0, extracted: 0, skippedDuplicates: 0, skipped: 0 };
  const errors = [];
  for (const result of accounts) {
    totals.examined += result.examined;
    totals.matched += result.matched;
    totals.extracted += result.extracted;
    totals.skippedDuplicates += result.skippedDuplicates;
    totals.skipped += result.skipped;
    if (result.error) errors.push(`${result.account}: ${result.error}`);
  }
  return { ...totals, accounts, ...(errors.length ? { error: errors.join('; ') } : {}) };
}

/**
 * Attempt a connection + read-only mailbox open with an explicit config
 * ({ host, port, user, password, secure }). Used by the per-account test
 * endpoint. Never throws.
 */
export async function testImapConnection(config) {
  if (!config || !config.host || !config.user || !config.password) {
    return { success: false, error: 'IMAP settings are incomplete (host, username and password are required).' };
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
  pickTextPart,
  pollAccount,
  pollAllInboxes,
  testImapConnection,
};
