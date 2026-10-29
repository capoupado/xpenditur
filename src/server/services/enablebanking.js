// Bank transaction sync via Enable Banking (enablebanking.com) — a PSD2
// account-information aggregator covering Portuguese banks (CGD, Novo Banco,
// …). The user registers a (free, personal) application at enablebanking.com,
// which yields an application ID and an RSA private key; every API call is
// authenticated with a short-lived RS256 JWT signed by that key (kid = app id,
// iss enablebanking.com, aud api.enablebanking.com).
//
// Consent flow: POST /auth (bank + validity + redirect_url + state) → the user
// authorizes at their bank → the bank redirects the browser back to our
// /api/bank/callback with ?code&state → POST /sessions {code} → a session with
// account uids, stored in bank_connections / bank_accounts. The `state` rows
// live in bank_auth_requests while a flow is in flight (single-use, short TTL).
//
// Synced transactions become pending_transactions — the same review pipeline
// as file imports; the ledger is never written directly.
// Dedup uses import_dedup under source id -1, keyed on the bank's
// entry_reference when present (content hash + occurrence counter otherwise).
//
// Test-only deviation: base URL is read from ENABLEBANKING_BASE_URL so
// verification can point at a local mock. Production leaves it unset.

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { getSetting } from './settings-store.js';
import { todayLocalDate, addDays, daysBetween, isValidDateString } from '../utils/dates.js';
import { isProcessed, recordProcessed } from './import-dedup.js';
import { toCents } from './ai-response.js';
import { otherCategoryId } from './statement-import.js';

// import_dedup source id for bank-synced rows (file imports use 0).
export const BANK_SYNC_SOURCE = -1;

const MAX_CONSENT_SECONDS = 90 * 86400; // PSD2 SCA ceiling — banks may cap lower
const FIRST_SYNC_LOOKBACK_DAYS = 89; // banks rarely serve >90 days without SCA
const RESYNC_OVERLAP_DAYS = 3;
const AUTH_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
// Consents expiring within this many days are surfaced in the app banner.
export const EXPIRY_WARNING_DAYS = 14;
const TZ = process.env.TZ || 'Europe/Lisbon';

function baseUrl() {
  return (process.env.ENABLEBANKING_BASE_URL || 'https://api.enablebanking.com').replace(/\/+$/, '');
}

function ebError(message, status = 502) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function isConfigured() {
  return !!(getSetting('enablebanking_app_id') && getSetting('enablebanking_private_key'));
}

function authToken() {
  const appId = getSetting('enablebanking_app_id');
  const privateKey = getSetting('enablebanking_private_key');
  if (!appId || !privateKey) {
    throw ebError('Enable Banking is not configured — set the application ID and private key in Settings.', 400);
  }
  try {
    return jwt.sign({}, privateKey, {
      algorithm: 'RS256',
      keyid: appId,
      issuer: 'enablebanking.com',
      audience: 'api.enablebanking.com',
      expiresIn: 3600,
    });
  } catch (err) {
    throw ebError(`Could not sign the Enable Banking JWT — is the private key a valid PEM? (${err.message})`, 400);
  }
}

async function ebFetch(path, { method = 'GET', body } = {}) {
  const token = authToken();
  let res;
  try {
    res = await fetch(baseUrl() + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw ebError(`Enable Banking request failed: ${err.message}`);
  }

  const text = await res.text().catch(() => '');
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const detail = json?.message || json?.detail || (text ? text.slice(0, 300) : '');
    const err = ebError(`Enable Banking ${method} ${path} → HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    err.httpStatus = res.status;
    throw err;
  }
  return json;
}

// ---------------------------------------------------------------------------
// Thin API wrappers
// ---------------------------------------------------------------------------

// Credentials check — returns the registered application's details.
export function getApplication() {
  return ebFetch('/application');
}

export async function listAspsps(country) {
  const cc = String(country || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) throw ebError('country must be a 2-letter code (e.g. PT)', 400);
  const resp = await ebFetch(`/aspsps?country=${cc}`);
  return Array.isArray(resp?.aspsps) ? resp.aspsps : [];
}

// ---------------------------------------------------------------------------
// Consent flow
// ---------------------------------------------------------------------------

/**
 * Start a bank authorization. Returns { url } for the browser to navigate to.
 * `redirectUrl` must exactly match a redirect URL registered on the Enable
 * Banking application; `returnUrl` is where OUR callback sends the browser
 * afterwards (the SPA's settings page).
 */
export async function startBankAuth({ aspspName, country, redirectUrl, returnUrl }) {
  const aspsps = await listAspsps(country);
  const aspsp = aspsps.find((a) => a.name === aspspName);
  if (!aspsp) throw ebError(`Bank "${aspspName}" not found for country ${country}.`, 400);

  const maxSeconds = Number(aspsp.maximum_consent_validity) || MAX_CONSENT_SECONDS;
  const validSeconds = Math.min(maxSeconds, MAX_CONSENT_SECONDS);
  const validUntil = new Date(Date.now() + validSeconds * 1000).toISOString();

  const state = crypto.randomUUID();
  // Opportunistic cleanup of abandoned flows, then record this one.
  db.prepare('DELETE FROM bank_auth_requests WHERE created_at < ?').run(
    new Date(Date.now() - AUTH_REQUEST_TTL_MS).toISOString()
  );
  db.prepare(
    'INSERT INTO bank_auth_requests (state, aspsp_name, aspsp_country, return_url, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(state, aspsp.name, String(country).toUpperCase(), returnUrl || null, new Date().toISOString());

  const resp = await ebFetch('/auth', {
    method: 'POST',
    body: {
      access: { valid_until: validUntil },
      aspsp: { name: aspsp.name, country: String(country).toUpperCase() },
      state,
      redirect_url: redirectUrl,
      psu_type: 'personal',
    },
  });
  if (!resp?.url) throw ebError('Enable Banking /auth returned no authorization URL.');
  return { url: resp.url, state };
}

/**
 * Complete the flow after the bank redirected back with ?code&state.
 * Exchanges the code for a session and stores the connection + its accounts.
 * The state row is single-use.
 */
export async function completeBankAuth({ code, state }) {
  const reqRow = db.prepare('SELECT * FROM bank_auth_requests WHERE state = ?').get(String(state || ''));
  if (!reqRow) {
    throw ebError('Unknown or expired authorization state — start the bank connection again from Settings.', 400);
  }
  db.prepare('DELETE FROM bank_auth_requests WHERE state = ?').run(reqRow.state);

  const session = await ebFetch('/sessions', { method: 'POST', body: { code: String(code || '') } });
  if (!session?.session_id) throw ebError('Enable Banking /sessions returned no session id.');

  const accounts = Array.isArray(session.accounts) ? session.accounts : [];
  const insertConn = db.prepare(
    'INSERT INTO bank_connections (session_id, aspsp_name, aspsp_country, valid_until) VALUES (?, ?, ?, ?)'
  );
  const insertAcc = db.prepare(
    'INSERT INTO bank_accounts (connection_id, uid, iban, name, currency) VALUES (?, ?, ?, ?, ?)'
  );
  const run = db.transaction(() => {
    const info = insertConn.run(
      session.session_id,
      session.aspsp?.name || reqRow.aspsp_name,
      session.aspsp?.country || reqRow.aspsp_country,
      session.access?.valid_until || null
    );
    const connectionId = info.lastInsertRowid;
    for (const acc of accounts) {
      if (!acc?.uid) continue;
      insertAcc.run(
        connectionId,
        acc.uid,
        acc.account_id?.iban || null,
        acc.name || null,
        acc.currency || null
      );
    }
    supersedeOlderConnections(connectionId);
    return connectionId;
  });
  const connectionId = run();
  return { connectionId, accounts: accounts.length, returnUrl: reqRow.return_url || null };
}

// A reconnect (renewing an expiring consent) yields a new session with the
// same account uids. The older connections covering those accounts are
// dropped, and each account keeps its sync window and paused/active state.
export function supersedeOlderConnections(connectionId) {
  const fresh = db.prepare('SELECT * FROM bank_accounts WHERE connection_id = ?').all(connectionId);
  const carry = db.prepare('UPDATE bank_accounts SET active = ?, last_sync = ? WHERE id = ?');
  const older = new Set();
  for (const acc of fresh) {
    const prev = db
      .prepare('SELECT * FROM bank_accounts WHERE uid = ? AND connection_id != ? ORDER BY id DESC')
      .get(acc.uid, connectionId);
    if (!prev) continue;
    carry.run(prev.active, prev.last_sync, acc.id);
    older.add(prev.connection_id);
  }
  for (const id of older) {
    const leftover = db
      .prepare(
        `SELECT COUNT(*) AS n FROM bank_accounts
         WHERE connection_id = ? AND uid NOT IN (SELECT uid FROM bank_accounts WHERE connection_id = ?)`
      )
      .get(id, connectionId).n;
    if (leftover === 0) db.prepare('DELETE FROM bank_connections WHERE id = ?').run(id);
  }
}

// Calendar date (app timezone) on which a consent stops working.
function expiryLocalDate(validUntil) {
  const d = new Date(validUntil);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * Every connection with a known consent end, plus `days_left` (0 = expires
 * today, negative = already expired).
 */
export function connectionExpiries({ today = todayLocalDate() } = {}) {
  return db
    .prepare('SELECT id, aspsp_name, aspsp_country, valid_until FROM bank_connections WHERE valid_until IS NOT NULL')
    .all()
    .map((c) => {
      const expires = expiryLocalDate(c.valid_until);
      return expires ? { ...c, expires_on: expires, days_left: daysBetween(today, expires) } : null;
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Connections listing / management
// ---------------------------------------------------------------------------

export function listConnections() {
  const connections = db.prepare('SELECT * FROM bank_connections ORDER BY id ASC').all();
  const accStmt = db.prepare('SELECT * FROM bank_accounts WHERE connection_id = ? ORDER BY id ASC');
  const expiries = new Map(connectionExpiries().map((e) => [e.id, e]));
  return connections.map((c) => ({
    ...c,
    expires_on: expiries.get(c.id)?.expires_on ?? null,
    days_left: expiries.get(c.id)?.days_left ?? null,
    accounts: accStmt.all(c.id),
  }));
}

export function deleteConnection(id) {
  // ON DELETE CASCADE drops the accounts; synced pending rows are retained as
  // audit log (they only reference the connection through display text).
  const info = db.prepare('DELETE FROM bank_connections WHERE id = ?').run(id);
  return info.changes > 0;
}

export function setAccountActive(id, active) {
  const info = db.prepare('UPDATE bank_accounts SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Transaction sync → pending_transactions
// ---------------------------------------------------------------------------

/**
 * Normalize one Enable Banking transaction into pending-row fields, or null
 * when unusable (no amount / no date / not booked).
 * Exported for unit testing.
 */
export function normalizeTransaction(txn) {
  if (!txn || typeof txn !== 'object') return null;
  if (txn.status && txn.status !== 'BOOK') return null; // pending/rejected at the bank — wait for booking

  const cents = toCents(txn.transaction_amount?.amount);
  if (cents === null || cents === 0) return null;

  const rawDate = txn.booking_date || txn.value_date || txn.transaction_date || '';
  const date = String(rawDate).slice(0, 10);
  if (!isValidDateString(date)) return null;

  const type = txn.credit_debit_indicator === 'CRDT' ? 'earning' : 'spending';
  const counterparty = (type === 'spending' ? txn.creditor?.name : txn.debtor?.name) || null;
  const remittance = Array.isArray(txn.remittance_information)
    ? txn.remittance_information.filter((s) => typeof s === 'string' && s.trim()).join(' ').trim()
    : '';
  const description = remittance || counterparty || null;

  let currency = 'EUR';
  const cur = txn.transaction_amount?.currency;
  if (typeof cur === 'string' && /^[a-z]{3}$/i.test(cur.trim())) currency = cur.trim().toUpperCase();

  return {
    type,
    amount: Math.abs(cents),
    currency,
    date,
    description,
    entryReference: typeof txn.entry_reference === 'string' && txn.entry_reference ? txn.entry_reference : null,
  };
}

async function fetchAllTransactions(accountUid, dateFrom) {
  const all = [];
  let continuationKey = null;
  do {
    const params = new URLSearchParams({ date_from: dateFrom });
    if (continuationKey) params.set('continuation_key', continuationKey);
    const page = await ebFetch(`/accounts/${encodeURIComponent(accountUid)}/transactions?${params}`);
    if (Array.isArray(page?.transactions)) all.push(...page.transactions);
    continuationKey = page?.continuation_key || null;
  } while (continuationKey);
  return all;
}

/**
 * Sync every active bank account: fetch transactions since the last sync
 * (minus an overlap; first sync reaches back ~90 days), dedup, and insert new
 * ones as pending rows. Never throws — per-account errors are reported in the
 * result. Returns { noop: true } when unconfigured or no active accounts.
 */
export async function syncBankAccounts() {
  if (!isConfigured()) return { noop: true };
  const accounts = db
    .prepare(
      `SELECT a.*, c.aspsp_name FROM bank_accounts a
       JOIN bank_connections c ON c.id = a.connection_id
       WHERE a.active = 1 ORDER BY a.id ASC`
    )
    .all();
  if (accounts.length === 0) return { noop: true };

  const categoryId = otherCategoryId();
  const insert = db.prepare(
    `INSERT INTO pending_transactions
       (type, amount, currency, description, suggested_category_id, date,
        source_label, source_kind, raw_extracted_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'bank-sync', ?, 'pending')`
  );

  const today = todayLocalDate();
  const totals = { fetched: 0, inserted: 0, skippedDuplicates: 0, skippedRows: 0 };
  const insertedIds = [];
  const perAccount = [];
  const errors = [];

  for (const account of accounts) {
    const label = `${account.aspsp_name} — ${account.name || account.iban || account.uid}`;
    const counts = { account: label, fetched: 0, inserted: 0, skippedDuplicates: 0, skippedRows: 0 };
    const dateFrom = account.last_sync
      ? addDays(String(account.last_sync).slice(0, 10), -RESYNC_OVERLAP_DAYS)
      : addDays(today, -FIRST_SYNC_LOOKBACK_DAYS);

    let transactions;
    try {
      transactions = await fetchAllTransactions(account.uid, dateFrom);
    } catch (err) {
      console.error(`[enablebanking] Sync failed for "${label}":`, err.message);
      const consentGone = err.httpStatus === 401 || err.httpStatus === 403;
      counts.error = consentGone
        ? `${err.message} — the consent may have expired; reconnect the bank in Settings.`
        : err.message;
      // The bank refused the consent before its stated end: record it as
      // expired now so the app banner offers a reconnect.
      if (consentGone) {
        db.prepare('UPDATE bank_connections SET valid_until = ? WHERE id = ? AND (valid_until IS NULL OR valid_until > ?)').run(
          new Date().toISOString(),
          account.connection_id,
          new Date().toISOString()
        );
      }
      errors.push(`${label}: ${counts.error}`);
      perAccount.push(counts);
      continue;
    }

    counts.fetched = transactions.length;
    const occurrences = new Map();
    for (const txn of transactions) {
      const row = normalizeTransaction(txn);
      if (!row) {
        counts.skippedRows++;
        continue;
      }
      let dedupId;
      if (row.entryReference) {
        dedupId = `eb:${account.uid}:${row.entryReference}`;
      } else {
        const key = `${row.date}|${row.type}|${row.amount}|${row.currency}|${(row.description || '').toLowerCase()}`;
        const occ = (occurrences.get(key) || 0) + 1;
        occurrences.set(key, occ);
        dedupId = `eb:${account.uid}:` + crypto.createHash('sha256').update(`${key}|${occ}`).digest('hex');
      }
      if (isProcessed(BANK_SYNC_SOURCE, dedupId)) {
        counts.skippedDuplicates++;
        continue;
      }
      recordProcessed(BANK_SYNC_SOURCE, dedupId);
      const info = insert.run(
        row.type,
        row.amount,
        row.currency,
        row.description,
        categoryId,
        row.date,
        `Bank: ${label}`,
        JSON.stringify({ source: 'bank-sync', account: label, ...txn })
      );
      insertedIds.push(Number(info.lastInsertRowid));
      counts.inserted++;
    }

    db.prepare('UPDATE bank_accounts SET last_sync = ? WHERE id = ?').run(new Date().toISOString(), account.id);
    totals.fetched += counts.fetched;
    totals.inserted += counts.inserted;
    totals.skippedDuplicates += counts.skippedDuplicates;
    totals.skippedRows += counts.skippedRows;
    perAccount.push(counts);
  }

  return { ...totals, insertedIds, accounts: perAccount, ...(errors.length ? { error: errors.join('; ') } : {}) };
}

export default {
  BANK_SYNC_SOURCE,
  isConfigured,
  getApplication,
  listAspsps,
  startBankAuth,
  completeBankAuth,
  listConnections,
  connectionExpiries,
  deleteConnection,
  setAccountActive,
  normalizeTransaction,
  syncBankAccounts,
};
