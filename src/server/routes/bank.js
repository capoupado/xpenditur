// Enable Banking bank-sync endpoints: credentials test, bank list, consent
// flow (connect + OAuth-style callback), connection management, manual sync.
//
// Everything requires auth EXCEPT /callback: the bank redirects the user's
// browser there cross-site, so instead of the session cookie it is guarded by
// the single-use `state` we generated at /connect (bank_auth_requests row).

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getSetting } from '../services/settings-store.js';
import { reviewNewPending } from '../services/pending-review.js';
import {
  isConfigured,
  getApplication,
  listAspsps,
  startBankAuth,
  completeBankAuth,
  listConnections,
  connectionExpiries,
  EXPIRY_WARNING_DAYS,
  deleteConnection,
  setAccountActive,
  syncBankAccounts,
} from '../services/enablebanking.js';

const router = express.Router();

// The redirect URL the /auth request will carry — must exactly match one
// registered on the Enable Banking application. Explicit setting wins; else
// derived from the incoming request's host.
function effectiveRedirectUrl(req) {
  return getSetting('enablebanking_redirect_url') || `${req.protocol}://${req.get('host')}/api/bank/callback`;
}

// GET /api/bank/callback — the bank's browser redirect. No auth cookie
// required (see header comment); the state parameter authenticates the flow.
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  let returnUrl = '/settings/bank';
  try {
    if (error) throw new Error(`The bank reported: ${error}`);
    if (!code || !state) throw new Error('Missing code/state in the bank redirect.');
    const result = await completeBankAuth({ code, state });
    if (result.returnUrl) returnUrl = result.returnUrl;
    res.redirect(`${returnUrl}?bank=connected&accounts=${result.accounts}`);
  } catch (err) {
    console.error('[bank] callback failed:', err.message);
    res.redirect(`${returnUrl}?bank=error&message=${encodeURIComponent(err.message)}`);
  }
});

router.use(requireAuth);

// GET /api/bank/status — is it configured, and do the credentials work?
router.get('/status', async (req, res) => {
  const configured = isConfigured();
  const payload = { configured, redirect_url: effectiveRedirectUrl(req) };
  if (!configured) return res.json(payload);
  try {
    const app = await getApplication();
    res.json({ ...payload, application: { name: app?.name || null, environment: app?.environment || null } });
  } catch (err) {
    res.json({ ...payload, error: err.message });
  }
});

// GET /api/bank/aspsps?country=PT — available banks.
router.get('/aspsps', async (req, res) => {
  try {
    const aspsps = await listAspsps(req.query.country || 'PT');
    res.json(
      aspsps.map((a) => ({
        name: a.name,
        country: a.country,
        logo: a.logo || null,
        maximum_consent_validity: a.maximum_consent_validity || null,
      }))
    );
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// POST /api/bank/connect { aspsp_name, country } — start the consent flow.
// Responds with the bank authorization URL for the browser to navigate to.
router.post('/connect', async (req, res) => {
  const { aspsp_name, country } = req.body || {};
  if (typeof aspsp_name !== 'string' || !aspsp_name.trim()) {
    return res.status(400).json({ error: 'aspsp_name is required' });
  }
  // After the callback completes we send the browser back to the SPA — in dev
  // that's the Vite origin (from the Referer), in production our own host.
  let returnUrl = '/settings/bank';
  try {
    const referer = req.get('referer');
    if (referer) returnUrl = new URL(referer).origin + '/settings/bank';
  } catch {
    /* keep default */
  }
  try {
    const result = await startBankAuth({
      aspspName: aspsp_name.trim(),
      country: country || 'PT',
      redirectUrl: effectiveRedirectUrl(req),
      returnUrl,
    });
    res.json({ url: result.url });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// GET /api/bank/expiry — connections whose consent has expired or will
// within EXPIRY_WARNING_DAYS (drives the app-wide banner).
router.get('/expiry', (req, res) => {
  res.json(connectionExpiries().filter((c) => c.days_left <= EXPIRY_WARNING_DAYS));
});

// GET /api/bank/connections — connections with their accounts.
router.get('/connections', (req, res) => {
  res.json(listConnections());
});

// DELETE /api/bank/connections/:id — forget a connection (accounts cascade;
// already-synced pending rows are kept as audit log).
router.delete('/connections/:id', (req, res) => {
  if (!deleteConnection(Number(req.params.id))) {
    return res.status(404).json({ error: 'Bank connection not found' });
  }
  res.json({ ok: true });
});

// PUT /api/bank/accounts/:id { active } — pause/resume syncing one account.
router.put('/accounts/:id', (req, res) => {
  const active = !(req.body?.active === false || req.body?.active === 'false' || req.body?.active === 0);
  if (!setAccountActive(Number(req.params.id), active)) {
    return res.status(404).json({ error: 'Bank account not found' });
  }
  res.json({ ok: true, active });
});

// POST /api/bank/sync — sync all active accounts now.
router.post('/sync', async (req, res) => {
  try {
    const { insertedIds = [], ...counts } = await syncBankAccounts();
    res.json({ ...counts, review: await reviewNewPending(insertedIds) });
  } catch (err) {
    console.error('[bank] sync failed:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
