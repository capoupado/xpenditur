import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { expiryText, reconnectBank } from '../../components/BankExpiryBanner.jsx';
import { SectionCard, inputCls } from './shared.jsx';

export default function BankSettings() {
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
                    <p
                      className={`text-xs ${
                        conn.days_left == null ? 'text-gray-500' : conn.days_left <= 3 ? 'text-red-400' : conn.days_left <= 14 ? 'text-amber-400' : 'text-gray-500'
                      }`}
                    >
                      {conn.days_left == null ? 'Consent expiry unknown' : `Consent ${expiryText(conn)}`}
                    </p>
                  </div>
                  <button
                    onClick={() => reconnectBank(conn).catch((err) => toast.error(err.message))}
                    className="text-gray-300 hover:text-white text-sm shrink-0"
                  >
                    Reconnect
                  </button>
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
