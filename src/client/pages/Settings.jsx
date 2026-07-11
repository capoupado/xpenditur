import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';

const WEEKDAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

function SectionCard({ title, description, children }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
      <h2 className="font-semibold text-lg mb-1">{title}</h2>
      {description && <p className="text-sm text-gray-500 mb-4">{description}</p>}
      {children}
    </div>
  );
}

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookMasked, setWebhookMasked] = useState('');
  const [threshold, setThreshold] = useState('80');
  const [weeklyDay, setWeeklyDay] = useState('1');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

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

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    setChangingPassword(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success('Password changed');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return <p className="text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Settings</h1>
        <p className="text-gray-500 text-sm">Discord notifications and account security.</p>
      </div>

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
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-xs text-gray-500 mt-1">Lower budget-alert threshold. 100% always alerts too.</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Weekly summary day</label>
              <select
                value={weeklyDay}
                onChange={(e) => setWeeklyDay(e.target.value)}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Change password">
        <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Current password</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">New password</label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Confirm new password</label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={changingPassword}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
            >
              {changingPassword ? 'Changing…' : 'Change password'}
            </button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
