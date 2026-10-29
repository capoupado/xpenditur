import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { SETTINGS_REGISTRY, getAllSettingsForDisplay, setSetting } from '../services/settings-store.js';
import { sendTestNotification } from '../services/notifications.js';
import { AI_PROVIDERS } from '../services/ai-providers.js';
import { getAiConfig, callAiChat, listModels } from '../services/ai-client.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/settings — every known setting, secret-ish values masked per the
// registry (discord_webhook_url, ai_key_<provider>).
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

// GET /api/settings/ai-providers — the provider catalogue for the Settings
// page (labels, key links, which ones need a base URL / key).
router.get('/ai-providers', (req, res) => {
  res.json(
    AI_PROVIDERS.map(({ id, label, keyUrl, keyOptional, note }) => ({
      id,
      label,
      keyUrl: keyUrl || null,
      note: note || null,
      keyOptional: !!keyOptional,
      needsBaseUrl: id === 'custom',
    }))
  );
});

// POST /api/settings/ai-models — { provider, apiKey?, baseUrl? }
// Fetches the provider's model list live. apiKey/baseUrl let the page list
// models for a key the user has typed but not saved yet; otherwise the stored
// values are used.
router.post('/ai-models', async (req, res) => {
  const { provider, apiKey, baseUrl } = req.body || {};
  try {
    const models = await listModels(provider, {
      apiKey: typeof apiKey === 'string' ? apiKey.trim() : undefined,
      baseUrl: typeof baseUrl === 'string' ? baseUrl.trim() : undefined,
    });
    res.json({ models });
  } catch (err) {
    // 4xx, not 502: reverse proxies/tunnels replace 5xx bodies with their own
    // error page, which would hide the provider's actual error message.
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /api/settings/ai-test — one tiny round-trip with the saved
// configuration so the user can confirm the provider/model/key combo works.
router.post('/ai-test', async (req, res) => {
  const cfg = getAiConfig();
  if (!cfg) return res.status(400).json({ error: 'AI provider is not fully configured (provider, key and model are required).' });
  try {
    const content = await callAiChat(cfg, {
      systemPrompt: 'Respond ONLY with a JSON object, no other text: {"ok": true}',
      userContent: 'ping',
    });
    res.json({ success: true, provider: cfg.label, model: cfg.model, reply: content.slice(0, 200) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
