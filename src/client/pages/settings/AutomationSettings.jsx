import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { SectionCard, inputCls, primaryBtn } from './shared.jsx';

function Toggle({ checked, onChange, title, hint, disabled }) {
  return (
    <label className={`flex items-start gap-2.5 text-sm text-gray-300 ${disabled ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-emerald-500"
      />
      <span>
        {title}
        <span className="block text-xs text-gray-500">{hint}</span>
      </span>
    </label>
  );
}

export default function AutomationSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoCategorize, setAutoCategorize] = useState(true);
  const [autoApprove, setAutoApprove] = useState(true);
  const [minConfidence, setMinConfidence] = useState('80');

  useEffect(() => {
    api
      .get('/settings')
      .then((data) => {
        setAutoCategorize(data.auto_categorize === '1');
        setAutoApprove(data.auto_approve === '1');
        setMinConfidence(String(data.auto_approve_min_confidence ?? '80'));
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/settings', {
        auto_categorize: autoCategorize ? '1' : '0',
        auto_approve: autoApprove ? '1' : '0',
        auto_approve_min_confidence: minConfidence,
      });
      toast.success('Automation settings saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <SectionCard
      title="New pending transactions"
      description="What happens right after a bank sync or statement import. Categories come from your own history first (same description → same category), then from the AI provider."
    >
      <form onSubmit={handleSave} className="space-y-4">
        <Toggle
          checked={autoCategorize}
          onChange={setAutoCategorize}
          title="Categorize automatically"
          hint="No more pressing ✨ Auto-categorize on every import."
        />
        <Toggle
          checked={autoApprove}
          onChange={setAutoApprove}
          title="Approve confident matches"
          hint="Rows whose category confidence meets the threshold go straight into the ledger, marked “auto” on the Approved tab. Foreign-currency and future-dated rows always wait for you."
        />
        <div className="max-w-xs">
          <label className="block text-xs text-gray-500 mb-1">Minimum confidence (%)</label>
          <input
            type="number"
            min="50"
            max="100"
            value={minConfidence}
            disabled={!autoApprove}
            onChange={(e) => setMinConfidence(e.target.value)}
            className={`${inputCls} disabled:opacity-50`}
          />
          <p className="text-xs text-gray-500 mt-1">
            History matches score by how consistently you've used that category for the description; AI matches use the
            model's own estimate.
          </p>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className={primaryBtn}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}
