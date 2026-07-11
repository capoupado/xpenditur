import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { SETTINGS_REGISTRY, getAllSettingsForDisplay, setSetting } from '../services/settings-store.js';
import { sendTestNotification } from '../services/notifications.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/settings — every known setting, secret-ish values masked per the
// registry (today just discord_webhook_url; Phase 6 will add imap_password /
// deepseek_api_key with `mask: true, encrypt: true` and this route needs no
// changes).
router.get('/', (req, res) => {
  res.json(getAllSettingsForDisplay());
});

// PUT /api/settings — upsert any subset of known keys. Each value is
// validated per the registry; on the first invalid key the whole request is
// rejected with 400 (no partial writes) so the client can show one clear
// error rather than silently dropping fields.
router.put('/', (req, res) => {
  const body = req.body || {};
  const keys = Object.keys(body);

  if (keys.length === 0) {
    return res.status(400).json({ error: 'No settings provided' });
  }

  const unknown = keys.filter((k) => !SETTINGS_REGISTRY[k]);
  if (unknown.length > 0) {
    return res.status(400).json({ error: `Unknown setting key(s): ${unknown.join(', ')}` });
  }

  for (const key of keys) {
    try {
      setSetting(key, body[key]);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  }

  res.json(getAllSettingsForDisplay());
});

// POST /api/settings/test-discord — sends a real test embed and reports
// success/failure from Discord's response. Unlike every other notification
// send, this one is awaited (the UI needs a real result), but it can never
// throw — sendTestNotification always resolves to { success, ... }.
router.post('/test-discord', async (req, res) => {
  const result = await sendTestNotification();
  res.status(result.success ? 200 : 400).json(result);
});

export default router;
