// Web Push (PWA notifications) — the second notification channel next to
// Discord (services/notifications.js decides which channel gets what).
//
// The VAPID keypair is generated on first boot and kept in settings (private
// half encrypted). Each subscribed browser/device is a push_subscriptions
// row; endpoints the push service reports as gone (404/410) are deleted.
// Like the Discord sends, nothing here throws into a caller.

import webpush from 'web-push';
import db from '../db.js';
import { getSetting, setSetting } from './settings-store.js';

// Contact for the push services, required by VAPID; not shown to anyone.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@xpenditur.local';

export function ensureVapidKeys() {
  if (getSetting('vapid_public_key') && getSetting('vapid_private_key')) return;
  const { publicKey, privateKey } = webpush.generateVAPIDKeys();
  setSetting('vapid_public_key', publicKey);
  setSetting('vapid_private_key', privateKey);
  console.log('[push] Generated a Web Push (VAPID) keypair.');
}

export function getVapidPublicKey() {
  return getSetting('vapid_public_key') || null;
}

export function saveSubscription(subscription, userAgent) {
  const endpoint = subscription?.endpoint;
  const keys = subscription?.keys;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || !keys?.p256dh || !keys?.auth) {
    const err = new Error('invalid push subscription');
    err.status = 400;
    throw err;
  }
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, keys_json, user_agent) VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET keys_json = excluded.keys_json, user_agent = excluded.user_agent`
  ).run(endpoint, JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth }), userAgent || null);
}

export function deleteSubscription(endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(String(endpoint || '')).changes > 0;
}

export function countSubscriptions() {
  return db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n;
}

/**
 * Send { title, body, url, tag } to every subscribed device. Resolves to
 * { sent, failed } and never rejects.
 */
export async function sendPushToAll(payload) {
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  if (subs.length === 0) return { sent: 0, failed: 0 };
  const publicKey = getSetting('vapid_public_key');
  const privateKey = getSetting('vapid_private_key');
  if (!publicKey || !privateKey) return { sent: 0, failed: subs.length };

  const options = { TTL: 24 * 3600, vapidDetails: { subject: VAPID_SUBJECT, publicKey, privateKey } };
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: JSON.parse(sub.keys_json) }, body, options);
        sent++;
      } catch (err) {
        failed++;
        if (err.statusCode === 404 || err.statusCode === 410) {
          deleteSubscription(sub.endpoint); // unsubscribed or expired on the device
        } else {
          console.error('[push] send failed (non-fatal):', err.statusCode || '', err.message);
        }
      }
    })
  );
  return { sent, failed };
}

export default { ensureVapidKeys, getVapidPublicKey, saveSubscription, deleteSubscription, countSubscriptions, sendPushToAll };
