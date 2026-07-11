import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { formatCents, formatDate } from '../lib/format.js';
import TransactionForm from '../components/TransactionForm.jsx';

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

function ConfidenceDot({ value }) {
  if (value == null) {
    return <span className="text-gray-500 text-xs">—</span>;
  }
  const color = value > 0.8 ? 'bg-emerald-500' : value >= 0.5 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
      <span className="text-xs text-gray-400">{Math.round(value * 100)}%</span>
    </span>
  );
}

// A pending amount rendered in its own currency; non-EUR shows a warning.
function AmountCell({ row }) {
  const isEur = row.currency === 'EUR';
  const value = (row.amount / 100).toFixed(2);
  return (
    <span className={`font-medium whitespace-nowrap ${row.type === 'earning' ? 'text-emerald-400' : 'text-red-400'}`}>
      {row.type === 'earning' ? '+' : '-'}
      {isEur ? formatCents(row.amount) : `${value} ${row.currency}`}
      {!isEur && (
        <span
          className="ml-1.5 text-amber-400"
          title="Non-EUR — quarantined. Use Edit & Approve to enter the real EUR amount."
        >
          ⚠
        </span>
      )}
    </span>
  );
}

export default function Pending() {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [polling, setPolling] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const loadCategories = () => api.get('/categories').then(setCategories);

  const load = (which = tab) => {
    setLoading(true);
    setSelected(new Set());
    return api
      .get(`/pending?status=${which}`)
      .then(setRows)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCategories().catch((err) => toast.error(err.message));
  }, []);

  useEffect(() => {
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const pollNow = async () => {
    setPolling(true);
    try {
      const c = await api.post('/pending/poll-now', {});
      if (c.noop) {
        toast('IMAP is not configured — nothing to poll.', { icon: 'ℹ️' });
      } else if (c.error) {
        toast.error(`Poll failed: ${c.error}`);
      } else {
        toast.success(
          `Examined ${c.examined}, matched ${c.matched}, extracted ${c.extracted}, duplicates ${c.skippedDuplicates}`
        );
      }
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPolling(false);
    }
  };

  const approve = async (row) => {
    setBusyId(row.id);
    try {
      await api.post(`/pending/${row.id}/approve`, {});
      toast.success('Approved — transaction created');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (row) => {
    setBusyId(row.id);
    try {
      await api.post(`/pending/${row.id}/reject`, {});
      toast.success('Rejected');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const submitEdited = async (payload) => {
    if (!editing) return;
    setSubmitting(true);
    try {
      await api.post(`/pending/${editing.id}/approve-edited`, payload);
      toast.success('Approved — transaction created');
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulk = async (action) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      const res = await api.post('/pending/bulk', { action, ids });
      const done = action === 'approve' ? res.approved : res.rejected;
      let msg = `${done} ${action === 'approve' ? 'approved' : 'rejected'}`;
      if (res.skipped && res.skipped.length) msg += `, ${res.skipped.length} skipped`;
      toast.success(msg);
      if (res.skipped && res.skipped.length) {
        res.skipped.forEach((s) => toast(`#${s.id}: ${s.reason}`, { icon: '⚠️' }));
      }
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const isPendingTab = tab === 'pending';

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold mb-1">Pending</h1>
          <p className="text-gray-500 text-sm">
            AI-extracted invoices awaiting your ruling. Approving creates a real transaction.
          </p>
        </div>
        <button
          onClick={pollNow}
          disabled={polling}
          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
        >
          {polling ? 'Polling…' : '⟳ Poll now'}
        </button>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isPendingTab && selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 bg-gray-900 border border-gray-800 rounded-lg px-4 py-2">
          <span className="text-sm text-gray-400">{selected.size} selected</span>
          <div className="flex-1" />
          <button
            onClick={() => bulk('approve')}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5"
          >
            Approve selected
          </button>
          <button
            onClick={() => bulk('reject')}
            className="rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium px-3 py-1.5"
          >
            Reject selected
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500">
          {isPendingTab ? 'No pending invoices. Configure IMAP + DeepSeek in Settings, then Poll now.' : 'Nothing here.'}
        </p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/50 text-gray-400">
              <tr>
                {isPendingTab && <th className="px-3 py-2 w-8" />}
                <th className="text-left px-4 py-2 font-medium">Vendor / Description</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-right px-4 py-2 font-medium">Amount</th>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-left px-4 py-2 font-medium">Suggested category</th>
                <th className="text-left px-4 py-2 font-medium">Confidence</th>
                <th className="text-left px-4 py-2 font-medium">Email subject</th>
                {isPendingTab && <th className="text-right px-4 py-2 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isEur = row.currency === 'EUR';
                return (
                  <tr key={row.id} className={`border-t border-gray-800 ${!isEur ? 'bg-amber-500/5' : ''}`}>
                    {isPendingTab && (
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggleSelect(row.id)}
                          className="accent-emerald-500"
                        />
                      </td>
                    )}
                    <td className="px-4 py-2 text-gray-300">{row.vendor || row.description || '—'}</td>
                    <td className="px-4 py-2 text-gray-400 capitalize">{row.type}</td>
                    <td className="px-4 py-2 text-right">
                      <AmountCell row={row} />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(row.date)}</td>
                    <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                      {row.suggested_category_icon} {row.suggested_category_name}
                    </td>
                    <td className="px-4 py-2">
                      <ConfidenceDot value={row.confidence} />
                    </td>
                    <td className="px-4 py-2 text-gray-500 max-w-[16rem] truncate" title={row.source_email_subject || ''}>
                      {row.source_email_subject || '—'}
                    </td>
                    {isPendingTab && (
                      <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                        <button
                          onClick={() => approve(row)}
                          disabled={busyId === row.id || !isEur}
                          title={isEur ? 'Approve' : 'Non-EUR is quarantined — use Edit & Approve'}
                          className="text-emerald-400 hover:text-emerald-300 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => setEditing(row)}
                          disabled={busyId === row.id}
                          className="text-blue-400 hover:text-blue-300 disabled:opacity-30"
                        >
                          Edit &amp; Approve
                        </button>
                        <button
                          onClick={() => reject(row)}
                          disabled={busyId === row.id}
                          className="text-red-400 hover:text-red-300 disabled:opacity-30"
                        >
                          Reject
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-md w-full">
            <h2 className="font-semibold text-lg mb-1">Edit &amp; Approve</h2>
            <p className="text-xs text-gray-500 mb-4">
              {editing.currency !== 'EUR'
                ? `Extracted as ${(editing.amount / 100).toFixed(2)} ${editing.currency} — enter the real EUR amount below.`
                : 'Adjust any field before approving. Amounts are in EUR.'}
            </p>
            <TransactionForm
              initial={{
                type: editing.type,
                amount: editing.amount,
                description: editing.description,
                category_id: editing.suggested_category_id,
                // Non-EUR / future-dated rows: let the user pick a valid date;
                // the form's max=today prevents a future date.
                date: editing.date,
              }}
              categories={categories}
              submitting={submitting}
              onSubmit={submitEdited}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
