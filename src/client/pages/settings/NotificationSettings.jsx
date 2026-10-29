import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { SectionCard, WEEKDAY_OPTIONS } from './shared.jsx';

export default function NotificationSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookMasked, setWebhookMasked] = useState('');
  const [threshold, setThreshold] = useState('80');
  const [weeklyDay, setWeeklyDay] = useState('1');
  const [unusualAlerts, setUnusualAlerts] = useState(true);


  const load = () => {
    setLoading(true);
    return api
      .get('/settings')
      .then((data) => {
        setWebhookMasked(data.discord_webhook_url || '');
        setThreshold(String(data.notification_budget_threshold ?? '80'));
        setWeeklyDay(String(data.weekly_summary_day ?? '1'));
        setUnusualAlerts(String(data.unusual_spending_alerts ?? '1') === '1');
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
        unusual_spending_alerts: unusualAlerts ? '1' : '0',
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
        title="Discord notifications"
        description="Get budget alerts, recurring-transaction reminders, and weekly/monthly summaries posted to a Discord channel via webhook."
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

          <label className="flex items-start gap-2.5 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={unusualAlerts}
              onChange={(e) => setUnusualAlerts(e.target.checked)}
              className="mt-0.5 accent-emerald-500"
            />
            <span>
              Unusual spending alerts
              <span className="block text-xs text-gray-500">
                Ping when a new spending is several times what you usually pay that payee or in that category.
              </span>
            </span>
          </label>

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
