// Web Push subscription management for the installed PWA / browser.

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getVapidPublicKey,
  saveSubscription,
  deleteSubscription,
  countSubscriptions,
  sendPushToAll,
} from '../services/push.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/push/config — the VAPID public key the browser subscribes with.
router.get('/config', (req, res) => {
  res.json({ publicKey: getVapidPublicKey(), devices: countSubscriptions() });
});

// POST /api/push/subscribe { subscription } — PushSubscription.toJSON().
router.post('/subscribe', (req, res) => {
  try {
    saveSubscription(req.body?.subscription, req.get('user-agent'));
    res.json({ ok: true, devices: countSubscriptions() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/push/unsubscribe { endpoint }
router.post('/unsubscribe', (req, res) => {
  deleteSubscription(req.body?.endpoint);
  res.json({ ok: true, devices: countSubscriptions() });
});

// POST /api/push/test — awaited so the page can report the outcome.
router.post('/test', async (req, res) => {
  const result = await sendPushToAll({
    title: 'xPenditur',
    body: 'Test notification — push is working on this device.',
    url: '/settings/notifications',
    tag: 'test',
  });
  if (result.sent === 0) {
    const error = result.failed
      ? 'Delivery failed — the subscription may have expired; disable and re-enable notifications on this device.'
      : 'No device subscribed — enable notifications first.';
    return res.status(400).json({ error, ...result });
  }
  res.json(result);
});

export default router;
