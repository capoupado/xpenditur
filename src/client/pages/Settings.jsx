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

const inputCls =
  'w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime';

function AiProviderSection() {
  const [providers, setProviders] = useState([]);
  const [settings, setSettings] = useState({});
  const [activeId, setActiveId] = useState(''); // saved active provider
  const [providerId, setProviderId] = useState(''); // provider being edited
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState([]);
  const [modelsError, setModelsError] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const provider = providers.find((p) => p.id === providerId) || null;
  const maskedKey = provider ? settings[`ai_key_${provider.id}`] || '' : '';

  const loadSettings = () =>
    api.get('/settings').then((data) => {
      setSettings(data);
      setActiveId(data.ai_provider || '');
      return data;
    });

  const fetchModels = async (id, { key, url } = {}) => {
    setLoadingModels(true);
    setModelsError('');
    try {
      const res = await api.post('/settings/ai-models', { provider: id, apiKey: key || undefined, baseUrl: url || undefined });
      setModels(res.models);
      if (res.models.length === 0) setModelsError('The provider returned no models — type a model id manually.');
    } catch (err) {
      setModels([]);
      setModelsError(`Could not list models (${err.message}). You can still type a model id manually.`);
    } finally {
      setLoadingModels(false);
    }
  };

  // Populate the form for a provider from saved settings, and list its models
  // straight away when it already has what it needs (a stored key or base URL).
  const selectProvider = (id, data = settings, list = providers) => {
    setProviderId(id);
    setApiKey('');
    setModel(data[`ai_model_${id}`] || '');
    setBaseUrl(data.ai_custom_base_url || '');
    setModels([]);
    setModelsError('');
    const meta = list.find((p) => p.id === id);
    if (!meta) return;
    const hasKey = !!data[`ai_key_${id}`];
    const ready = meta.needsBaseUrl ? !!data.ai_custom_base_url && (hasKey || meta.keyOptional) : hasKey;
    if (ready) fetchModels(id);
  };

  useEffect(() => {
    Promise.all([api.get('/settings/ai-providers'), loadSettings()])
      .then(([list, data]) => {
        setProviders(list);
        selectProvider(data.ai_provider || list[0]?.id || '', data, list);
      })
      .catch((err) => toast.error(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyBlur = () => {
    if (!provider || !apiKey.trim()) return;
    if (provider.needsBaseUrl && !baseUrl.trim()) return;
    fetchModels(provider.id, { key: apiKey.trim(), url: baseUrl.trim() });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!provider) return;
    if (!model.trim()) {
      toast.error('Pick or type a model first');
      return;
    }
    setSaving(true);
    try {
      const payload = { ai_provider: provider.id, [`ai_model_${provider.id}`]: model.trim() };
      // Only send the key if a new one was typed (else we'd store the mask).
      if (apiKey.trim() !== '') payload[`ai_key_${provider.id}`] = apiKey.trim();
      if (provider.needsBaseUrl) payload.ai_custom_base_url = baseUrl.trim();
      await api.put('/settings', payload);
      toast.success(`${provider.label} is now the active AI provider`);
      setApiKey('');
      await loadSettings();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await api.post('/settings/ai-test', {});
      toast.success(`${res.provider} (${res.model}) answered`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTesting(false);
    }
  };

  const activeLabel = providers.find((p) => p.id === activeId)?.label;
  const activeModel = activeId ? settings[`ai_model_${activeId}`] : '';

  return (
    <SectionCard
      title="AI provider"
      description="Used to parse PDF bank statements and suggest categories. Each provider keeps its own key and model, so you can switch freely."
    >
      <form onSubmit={handleSave} className="space-y-4">
        <p className="text-sm text-gray-400">
          {activeLabel ? (
            <>
              Active: <span className="text-gray-200">{activeLabel}</span>
              {activeModel ? <> · <span className="font-mono text-gray-200">{activeModel}</span></> : ' · no model set'}
            </>
          ) : (
            'No AI provider configured — PDF import and AI categorization are disabled.'
          )}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Provider</label>
            <select value={providerId} onChange={(e) => selectProvider(e.target.value)} className={inputCls}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {settings[`ai_key_${p.id}`] ? ' — key saved' : ''}
                  {p.id === activeId ? ' (active)' : ''}
                </option>
              ))}
            </select>
          </div>
          {provider && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                API key{provider.keyOptional ? ' (optional)' : ''}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onBlur={handleKeyBlur}
                placeholder={maskedKey || 'Paste API key'}
                className={inputCls}
                autoComplete="off"
              />
              <p className="text-xs text-gray-500 mt-1">
                {maskedKey ? `Currently set: ${maskedKey}. Leave blank to keep it.` : 'Not configured.'}
                {provider.keyUrl && (
                  <>
                    {' '}
                    <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300">
                      Get a key
                    </a>
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        {provider?.note && <p className="text-xs text-amber-400">{provider.note}</p>}

        {provider?.needsBaseUrl && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Base URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              className={inputCls}
            />
            <p className="text-xs text-gray-500 mt-1">
              Any OpenAI-compatible server (Ollama, LM Studio, vLLM…). Requests go to &lt;base URL&gt;/chat/completions.
            </p>
          </div>
        )}

        {provider && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Model</label>
            <div className="flex gap-2">
              <input
                list="ai-model-options"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={loadingModels ? 'Loading models…' : 'Pick from the list or type a model id'}
                className={`${inputCls} font-mono`}
              />
              <datalist id="ai-model-options">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <button
                type="button"
                onClick={() => fetchModels(provider.id, { key: apiKey.trim(), url: baseUrl.trim() })}
                disabled={loadingModels}
                className="rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-sm font-medium px-3 py-2 transition-colors shrink-0"
              >
                {loadingModels ? 'Loading…' : 'Refresh models'}
              </button>
            </div>
            <p className={`text-xs mt-1 ${modelsError ? 'text-amber-400' : 'text-gray-500'}`}>
              {modelsError || (models.length ? `${models.length} models available from ${provider.label}.` : 'Enter a key to load the model list.')}
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !activeId}
            className="rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-sm font-medium px-4 py-2 transition-colors"
          >
            {testing ? 'Testing…' : 'Test active provider'}
          </button>
          <button
            type="submit"
            disabled={saving || !provider}
            className="rounded-lg bg-lime-mid hover:bg-[#7aab5c] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
          >
            {saving ? 'Saving…' : 'Save & use this provider'}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}

function BankSyncSection() {
  const [status, setStatus] = useState(null);
  const [appId, setAppId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  const [privateKeyMasked, setPrivateKeyMasked] = useState('');
  const [saving, setSaving] = useState(false);
  const [connections, setConnections] = useState([]);
  const [banks, setBanks] = useState(null); // null = not loaded yet
  const [country, setCountry] = useState('PT');
  const [selectedBank, setSelectedBank] = useState('');
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadAll = () =>
    Promise.all([
      api.get('/settings').then((data) => {
        setAppId(data.enablebanking_app_id || '');
        setRedirectUrl(data.enablebanking_redirect_url || '');
        setPrivateKeyMasked(data.enablebanking_private_key || '');
      }),
      api.get('/bank/connections').then(setConnections),
      api.get('/bank/status').then(setStatus),
    ]).catch((err) => toast.error(err.message));

  useEffect(() => {
    // Toast for the round-trip back from the bank, then clean the URL.
    const params = new URLSearchParams(window.location.search);
    if (params.get('bank') === 'connected') {
      toast.success(`Bank connected (${params.get('accounts') || '?'} account(s)) — press "Sync now" to fetch transactions.`);
    } else if (params.get('bank') === 'error') {
      toast.error(`Bank connection failed: ${params.get('message') || 'unknown error'}`);
    }
    if (params.get('bank')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        enablebanking_app_id: appId.trim(),
        enablebanking_redirect_url: redirectUrl.trim(),
      };
      // Only send the key if a new one was pasted (else we'd store the mask).
      if (privateKey.trim() !== '') payload.enablebanking_private_key = privateKey.trim();
      await api.put('/settings', payload);
      toast.success('Bank sync settings saved');
      setPrivateKey('');
      await loadAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const loadBanks = async () => {
    setLoadingBanks(true);
    try {
      const list = await api.get(`/bank/aspsps?country=${encodeURIComponent(country.trim().toUpperCase())}`);
      setBanks(list);
      setSelectedBank(list[0]?.name || '');
      if (list.length === 0) toast('No banks found for that country.', { icon: 'ℹ️' });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingBanks(false);
    }
  };

  const connect = async () => {
    if (!selectedBank) return;
    setConnecting(true);
    try {
      const { url } = await api.post('/bank/connect', {
        aspsp_name: selectedBank,
        country: country.trim().toUpperCase(),
      });
      window.location.href = url; // off to the bank's consent page
    } catch (err) {
      toast.error(err.message);
      setConnecting(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const c = await api.post('/bank/sync', {});
      if (c.noop) {
        toast('Nothing to sync — configure credentials and connect a bank first.', { icon: 'ℹ️' });
      } else {
        toast.success(`Fetched ${c.fetched}, new ${c.inserted}, duplicates ${c.skippedDuplicates}`);
        if (c.error) toast.error(c.error);
      }
      await loadAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const toggleAccount = async (acc) => {
    try {
      await api.put(`/bank/accounts/${acc.id}`, { active: acc.active ? false : true });
      await loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/bank/connections/${deleteTarget.id}`);
      toast.success('Bank connection removed');
      setDeleteTarget(null);
      await loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const configured = status?.configured;

  return (
    <SectionCard
      title="Bank sync (Enable Banking)"
      description="Pull transactions from your banks (e.g. CGD, Novo Banco) into Pending via the Enable Banking PSD2 aggregator. Register a free personal application at enablebanking.com, download its private key, and paste the credentials here. Synced transactions are reviewed on the Pending page — nothing enters the ledger automatically. Sync runs daily at 07:30, or on demand below."
    >
      <div className="space-y-5">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Application ID</label>
              <input
                type="text"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="from enablebanking.com → Applications"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Redirect URL</label>
              <input
                type="text"
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                placeholder={status?.redirect_url || 'http://localhost:3000/api/bank/callback'}
                className={inputCls}
              />
              <p className="text-xs text-gray-500 mt-1">
                Must be registered on the Enable Banking application. Leave blank to use{' '}
                <code className="text-gray-400">{status?.redirect_url || '…'}</code>
              </p>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Private key (PEM)</label>
            <textarea
              rows={3}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder={privateKeyMasked ? `Currently set: ${privateKeyMasked} — leave blank to keep` : '-----BEGIN PRIVATE KEY-----'}
              className={`${inputCls} font-mono`}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-end">
            {configured && status?.application && (
              <span className="text-xs text-emerald-400 mr-auto">
                ✓ Credentials OK — app “{status.application.name}” ({status.application.environment})
              </span>
            )}
            {configured && status?.error && (
              <span className="text-xs text-red-400 mr-auto">Credentials check failed: {status.error}</span>
            )}
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-lime-mid hover:bg-[#7aab5c] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>

        {configured && !status?.error && (
          <div className="border-t border-gray-800 pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-300">Connected banks</h3>
              <button
                type="button"
                onClick={syncNow}
                disabled={syncing || connections.length === 0}
                className="rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-sm font-medium px-3 py-1.5 transition-colors"
              >
                {syncing ? 'Syncing…' : '⟳ Sync now'}
              </button>
            </div>

            {connections.length === 0 && <p className="text-sm text-gray-500">No banks connected yet.</p>}

            {connections.map((conn) => (
              <div key={conn.id} className="border border-gray-800 rounded-lg px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-200">
                      {conn.aspsp_name} <span className="text-gray-500">({conn.aspsp_country})</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      Consent valid until {conn.valid_until ? conn.valid_until.slice(0, 10) : 'unknown'} — reconnect
                      after it expires.
                    </p>
                  </div>
                  <button
                    onClick={() => setDeleteTarget(conn)}
                    className="text-red-400 hover:text-red-300 text-sm shrink-0"
                  >
                    Remove
                  </button>
                </div>
                {conn.accounts.length > 0 && (
                  <div className="mt-2 divide-y divide-gray-800 border-t border-gray-800">
                    {conn.accounts.map((acc) => (
                      <div key={acc.id} className={`flex items-center gap-3 py-2 ${acc.active ? '' : 'opacity-50'}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-300 truncate">
                            {acc.name || 'Account'} {acc.iban ? `— ${acc.iban}` : ''} ({acc.currency || '—'})
                          </p>
                          <p className="text-xs text-gray-500">
                            {acc.last_sync ? `Last sync ${acc.last_sync.slice(0, 16).replace('T', ' ')}` : 'Never synced'}
                          </p>
                        </div>
                        <button
                          onClick={() => toggleAccount(acc)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                            acc.active ? 'bg-emerald-600' : 'bg-gray-600'
                          }`}
                          aria-label={acc.active ? 'Pause account sync' : 'Resume account sync'}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              acc.active ? 'translate-x-5' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div className="border border-gray-800 rounded-lg p-4 bg-gray-950/50 space-y-3">
              <h4 className="text-sm font-medium text-gray-300">Connect a bank</h4>
              <div className="flex flex-wrap gap-2 items-end">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Country</label>
                  <input
                    type="text"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    maxLength={2}
                    className={`${inputCls} w-20 uppercase`}
                  />
                </div>
                <button
                  type="button"
                  onClick={loadBanks}
                  disabled={loadingBanks || country.trim().length !== 2}
                  className="rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-sm font-medium px-4 py-2 transition-colors"
                >
                  {loadingBanks ? 'Loading…' : banks === null ? 'Load banks' : 'Reload banks'}
                </button>
                {banks !== null && banks.length > 0 && (
                  <>
                    <div className="flex-1 min-w-[12rem]">
                      <label className="block text-xs text-gray-500 mb-1">Bank</label>
                      <select value={selectedBank} onChange={(e) => setSelectedBank(e.target.value)} className={inputCls}>
                        {banks.map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={connect}
                      disabled={connecting || !selectedBank}
                      className="rounded-lg bg-lime-mid hover:bg-[#7aab5c] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
                    >
                      {connecting ? 'Redirecting…' : 'Connect →'}
                    </button>
                  </>
                )}
              </div>
              <p className="text-xs text-gray-500">
                You'll be sent to the bank to authorize read-only access, then brought back here. Consents last up to
                ~90 days (bank-dependent).
              </p>
            </div>
          </div>
        )}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-sm w-full">
            <h2 className="font-semibold text-lg mb-2">Remove this bank connection?</h2>
            <p className="text-sm text-gray-400 mb-4">
              {deleteTarget.aspsp_name} ({deleteTarget.aspsp_country}). Syncing stops for its accounts;
              already-synced pending transactions are kept.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-medium px-4 py-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium px-4 py-2 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
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
  const [unusualAlerts, setUnusualAlerts] = useState(true);

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
        <h1 className="text-[clamp(22px,2.6vw,28px)] font-extrabold tracking-tighter mb-1">Settings</h1>
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

      <AiProviderSection />

      <BankSyncSection />

      <SectionCard title="Change password">
        <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Current password</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime"
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
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime"
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
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={changingPassword}
              className="rounded-lg bg-lime-mid hover:bg-[#7aab5c] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
            >
              {changingPassword ? 'Changing…' : 'Change password'}
            </button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
