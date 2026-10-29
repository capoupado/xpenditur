import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { SectionCard, WEEKDAY_OPTIONS, inputCls, primaryBtn, secondaryBtn } from './shared.jsx';

const CHANNELS = [
  { value: 'off', label: 'Off' },
  { value: 'push', label: 'Push' },
  { value: 'discord', label: 'Discord' },
  { value: 'both', label: 'Both' },
];

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// Push on THIS browser/device: subscribe, unsubscribe, test.
function PushDeviceCard() {
  const [subscription, setSubscription] = useState(null);
  const [devices, setDevices] = useState(0);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();
  const isIos = /iphone|ipad/i.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;

  useEffect(() => {
    api.get('/push/config').then((c) => setDevices(c.devices)).catch(() => {});
    if (!supported) return;
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then(setSubscription).catch(() => {});
  }, [supported]);

  const enable = async () => {
    setBusy(true);
    try {
      if ((await Notification.requestPermission()) !== 'granted') {
        throw new Error('Notifications are blocked for this site — allow them in the browser settings.');
      }
      const { publicKey } = await api.get('/push/config');
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const res = await api.post('/push/subscribe', { subscription: sub.toJSON() });
      setSubscription(sub);
      setDevices(res.devices);
      toast.success('Notifications enabled on this device');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const res = await api.post('/push/unsubscribe', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
      setSubscription(null);
      setDevices(res.devices);
      toast.success('Notifications disabled on this device');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const res = await api.post('/push/test', {});
      toast.success(`Sent to ${res.sent} device${res.sent === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="Push notifications"
      description={`Notifications from the installed app or this browser. ${devices} device${devices === 1 ? '' : 's'} subscribed.`}
    >
      {!supported ? (
        <p className="text-sm text-gray-400">
          {isIos && !standalone
            ? 'On iPhone/iPad, first add xPenditur to the Home Screen (Share → Add to Home Screen), open it from there, and enable notifications here.'
            : window.isSecureContext
              ? "This browser doesn't support push notifications."
              : 'Push needs HTTPS — open xPenditur through its https:// address.'}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`mr-auto text-sm ${subscription ? 'text-emerald-400' : 'text-gray-400'}`}>
            {subscription ? '✓ Enabled on this device' : 'Not enabled on this device'}
          </span>
          {subscription && (
            <button type="button" onClick={test} disabled={busy} className={secondaryBtn}>
              Send test
            </button>
          )}
          <button type="button" onClick={subscription ? disable : enable} disabled={busy} className={subscription ? secondaryBtn : primaryBtn}>
            {subscription ? 'Disable' : 'Enable notifications'}
          </button>
        </div>
      )}
    </SectionCard>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

// Which notification goes where, plus when to remind about pending rows.
function RoutingCard() {
  const [types, setTypes] = useState(null);
  const [values, setValues] = useState({});
  const [hours, setHours] = useState(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/settings/notification-types'), api.get('/settings')])
      .then(([t, data]) => {
        setTypes(t);
        setValues(Object.fromEntries(t.map(({ type }) => [type, data[`notify_${type}`]])));
        setHours(new Set(String(data.pending_reminder_hours || '').split(',').filter(Boolean).map(Number)));
      })
      .catch((err) => toast.error(err.message));
  }, []);

  const toggleHour = (h) =>
    setHours((prev) => {
      const next = new Set(prev);
      if (next.has(h)) next.delete(h);
      else next.add(h);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', {
        ...Object.fromEntries(Object.entries(values).map(([type, v]) => [`notify_${type}`, v])),
        pending_reminder_hours: [...hours].sort((a, b) => a - b).join(','),
      });
      toast.success('Notification settings saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!types) return null;

  return (
    <SectionCard title="What to send where" description="Pick the channel for each kind of notification.">
      <div className="divide-y divide-gray-800 border-y border-gray-800">
        {types.map(({ type, label }) => (
          <div key={type} className="flex flex-wrap items-center gap-3 py-2">
            <span className="flex-1 min-w-[12rem] text-sm text-gray-300">{label}</span>
            <div className="flex">
              {CHANNELS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setValues((v) => ({ ...v, [type]: c.value }))}
                  className={`border px-2.5 py-1 text-xs font-medium -ml-px first:ml-0 transition-colors ${
                    values[type] === c.value
                      ? 'relative border-lime bg-lime/[.16] text-cream'
                      : 'border-gray-700 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <label className="block text-xs text-gray-500 mb-2">
          Remind me about pending transactions at ({hours.size === 0 ? 'never' : `${hours.size}× a day`}) — only when
          something is waiting
        </label>
        <div className="grid grid-cols-8 sm:grid-cols-12 gap-1 max-w-xl">
          {HOURS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => toggleHour(h)}
              className={`border py-1 text-xs xp-num transition-colors ${
                hours.has(h) ? 'border-lime bg-lime/[.16] text-cream' : 'border-gray-800 text-gray-500 hover:text-gray-300'
              }`}
            >
              {String(h).padStart(2, '0')}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button type="button" onClick={save} disabled={saving} className={primaryBtn}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </SectionCard>
  );
}

export default function NotificationSettings() {
  return (
    <>
      <PushDeviceCard />
      <RoutingCard />
      <DiscordCard />
    </>
  );
}

function DiscordCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookMasked, setWebhookMasked] = useState('');
  const [threshold, setThreshold] = useState('80');
  const [weeklyDay, setWeeklyDay] = useState('1');


  const load = () => {
    setLoading(true);
    return api
      .get('/settings')
      .then((data) => {
        setWebhookMasked(data.discord_webhook_url || '');
        setThreshold(String(data.notification_budget_threshold ?? '80'));
        setWeeklyDay(String(data.weekly_summary_day ?? '1'));
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSaveNotifications = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        notification_budget_threshold: threshold,
        weekly_summary_day: weeklyDay,
      };
      // Only send the webhook URL if the user actually typed a new one —
      // otherwise we'd overwrite the stored value with its own masked preview.
      if (webhookUrl.trim() !== '') {
        payload.discord_webhook_url = webhookUrl.trim();
      }
      await api.put('/settings', payload);
      toast.success('Settings saved');
      setWebhookUrl('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClearWebhook = async () => {
    setSaving(true);
    try {
      await api.put('/settings', { discord_webhook_url: '' });
      toast.success('Discord webhook cleared');
      setWebhookUrl('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestDiscord = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/settings/test-discord', { method: 'POST', credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) {
        toast.success('Test notification sent — check Discord');
      } else {
        toast.error(body.error || 'Test notification failed');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <p className="text-gray-500">Loading…</p>;
  }


  return (
    <>
      <SectionCard
        title="Discord"
        description="Notifications set to Discord or Both above are posted to a Discord channel via webhook."
      >
        <form onSubmit={handleSaveNotifications} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Discord webhook URL</label>
            <input
              type="text"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder={webhookMasked || 'https://discord.com/api/webhooks/...'}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime"
            />
            <p className="text-xs text-gray-500 mt-1">
              {webhookMasked ? `Currently set: ${webhookMasked}` : 'Not configured yet.'} Leave blank to keep the
              current value.
            </p>
            {webhookMasked && (
              <button
                type="button"
                onClick={handleClearWebhook}
                disabled={saving}
                className="text-xs text-red-400 hover:text-red-300 mt-1"
              >
                Clear webhook
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Budget-alert threshold (%)</label>
              <input
                type="number"
                min="1"
                max="99"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime"
              />
              <p className="text-xs text-gray-500 mt-1">Lower budget-alert threshold. 100% always alerts too.</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Weekly summary day</label>
              <select
                value={weeklyDay}
                onChange={(e) => setWeeklyDay(e.target.value)}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime"
              >
                {WEEKDAY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={handleTestDiscord}
              disabled={testing}
              className="rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-sm font-medium px-4 py-2 transition-colors"
            >
              {testing ? 'Sending…' : 'Send test notification'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-lime-mid hover:bg-[#7aab5c] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </SectionCard>
    </>
  );
}
