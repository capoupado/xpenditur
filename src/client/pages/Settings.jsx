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

  // Phase 6 — Email invoice auto-tracking
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapUser, setImapUser] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [imapPasswordMasked, setImapPasswordMasked] = useState('');
  const [imapTls, setImapTls] = useState('true');
  const [pollInterval, setPollInterval] = useState('15');
  const [allowlist, setAllowlist] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [deepseekMasked, setDeepseekMasked] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [testingImap, setTestingImap] = useState(false);

  const load = () => {
    setLoading(true);
    return api
      .get('/settings')
      .then((data) => {
        setWebhookMasked(data.discord_webhook_url || '');
        setThreshold(String(data.notification_budget_threshold ?? '80'));
        setWeeklyDay(String(data.weekly_summary_day ?? '1'));
        setImapHost(data.imap_host || '');
        setImapPort(String(data.imap_port ?? '993'));
        setImapUser(data.imap_user || '');
        setImapPasswordMasked(data.imap_password || '');
        setImapTls(String(data.imap_tls ?? 'true'));
        setPollInterval(String(data.imap_poll_interval_minutes ?? '15'));
        setAllowlist(data.imap_sender_allowlist || '');
        setDeepseekMasked(data.deepseek_api_key || '');
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

  const handleSaveEmail = async (e) => {
    e.preventDefault();
    setSavingEmail(true);
    try {
      const payload = {
        imap_host: imapHost.trim(),
        imap_port: imapPort,
        imap_user: imapUser.trim(),
        imap_tls: imapTls,
        imap_poll_interval_minutes: pollInterval,
        imap_sender_allowlist: allowlist,
      };
      // Only send secrets if the user typed a new one (else we'd overwrite the
      // stored value with its masked preview).
      if (imapPassword.trim() !== '') payload.imap_password = imapPassword.trim();
      if (deepseekKey.trim() !== '') payload.deepseek_api_key = deepseekKey.trim();
      await api.put('/settings', payload);
      toast.success('Email settings saved');
      setImapPassword('');
      setDeepseekKey('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingEmail(false);
    }
  };

  const handleTestImap = async () => {
    setTestingImap(true);
    try {
      const body = { host: imapHost.trim(), port: imapPort, user: imapUser.trim(), tls: imapTls };
      if (imapPassword.trim() !== '') body.password = imapPassword.trim();
      const res = await fetch('/api/settings/test-imap', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) toast.success('IMAP connection OK');
      else toast.error(data.error || 'IMAP connection failed');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTestingImap(false);
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

      <SectionCard
        title="Email invoice auto-tracking"
        description="Poll a read-only IMAP mailbox for invoices/receipts and extract them with DeepSeek into Pending transactions. The mailbox is never modified."
      >
        <form onSubmit={handleSaveEmail} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">IMAP host</label>
              <input
                type="text"
                value={imapHost}
                onChange={(e) => setImapHost(e.target.value)}
                placeholder="imap.example.com"
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Port</label>
              <input
                type="number"
                value={imapPort}
                onChange={(e) => setImapPort(e.target.value)}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Username</label>
              <input
                type="text"
                value={imapUser}
                onChange={(e) => setImapUser(e.target.value)}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Password</label>
              <input
                type="password"
                value={imapPassword}
                onChange={(e) => setImapPassword(e.target.value)}
                placeholder={imapPasswordMasked || 'Mailbox password / app password'}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                {imapPasswordMasked ? `Currently set: ${imapPasswordMasked}` : 'Not configured.'} Leave blank to keep it.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">TLS</label>
              <select
                value={imapTls}
                onChange={(e) => setImapTls(e.target.value)}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="true">On (implicit TLS)</option>
                <option value="false">Off</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Poll interval (minutes)</label>
              <input
                type="number"
                min="1"
                max="1440"
                value={pollInterval}
                onChange={(e) => setPollInterval(e.target.value)}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Sender allow-list (optional)</label>
            <textarea
              rows={2}
              value={allowlist}
              onChange={(e) => setAllowlist(e.target.value)}
              placeholder="billing@shop.com, noreply@utility.com — leave blank to accept any sender"
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-xs text-gray-500 mt-1">Comma or newline separated. Empty means no sender filter.</p>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">DeepSeek API key</label>
            <input
              type="password"
              value={deepseekKey}
              onChange={(e) => setDeepseekKey(e.target.value)}
              placeholder={deepseekMasked || 'sk-...'}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              {deepseekMasked ? `Currently set: ${deepseekMasked}` : 'Not configured.'} Leave blank to keep it.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={handleTestImap}
              disabled={testingImap}
              className="rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-sm font-medium px-4 py-2 transition-colors"
            >
              {testingImap ? 'Testing…' : 'Test IMAP connection'}
            </button>
            <button
              type="submit"
              disabled={savingEmail}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
            >
              {savingEmail ? 'Saving…' : 'Save'}
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
