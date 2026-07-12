// Multiple IMAP mailbox accounts — CRUD + per-account connection test.
// Passwords are write-only through this API: responses carry password_masked,
// never the secret, and an empty/absent password on PUT means "keep it".

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listAccounts,
  getAccountRow,
  createAccount,
  updateAccount,
  deleteAccount,
  accountConfig,
} from '../services/imap-accounts.js';
import { testImapConnection } from '../services/imap.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(listAccounts());
});

router.post('/', (req, res) => {
  try {
    res.status(201).json(createAccount(req.body || {}));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const updated = updateAccount(Number(req.params.id), req.body || {});
    if (!updated) return res.status(404).json({ error: 'Mailbox account not found' });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  if (!deleteAccount(Number(req.params.id))) {
    return res.status(404).json({ error: 'Mailbox account not found' });
  }
  res.json({ ok: true });
});

// POST /api/imap-accounts/test — try a connection with the values from the
// body (so unsaved form edits can be tested). If `id` is given and no password
// was typed, fall back to that account's stored password — the UI never
// round-trips the real secret.
router.post('/test', async (req, res) => {
  const body = req.body || {};
  let password = typeof body.password === 'string' && body.password.trim() ? body.password.trim() : '';
  if (!password && body.id) {
    const row = getAccountRow(Number(body.id));
    const stored = row ? accountConfig(row) : null;
    if (stored) password = stored.password;
  }

  const port = Number(body.port);
  const result = await testImapConnection({
    host: typeof body.host === 'string' ? body.host.trim() : '',
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 993,
    user: typeof body.username === 'string' ? body.username.trim() : '',
    password,
    secure: body.tls === false || body.tls === 'false' || body.tls === 0 ? false : true,
  });
  res.status(result.success ? 200 : 400).json(result);
});

export default router;
