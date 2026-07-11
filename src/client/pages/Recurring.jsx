import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { formatCents, formatDate, describeFrequency } from '../lib/format.js';
import RecurringForm from '../components/RecurringForm.jsx';

export default function Recurring() {
  const [categories, setCategories] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const loadCategories = () => api.get('/categories').then(setCategories);

  const loadRecurring = () => {
    setLoading(true);
    return api
      .get('/recurring')
      .then(setRecurring)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCategories().catch((err) => toast.error(err.message));
    loadRecurring();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (rec) => {
    setEditing(rec);
    setShowForm(true);
  };

  const handleSubmit = async (payload) => {
    setSubmitting(true);
    try {
      if (editing) {
        await api.put(`/recurring/${editing.id}`, payload);
        toast.success('Recurring transaction updated');
      } else {
        await api.post('/recurring', payload);
        toast.success('Recurring transaction added');
      }
      setShowForm(false);
      setEditing(null);
      await loadRecurring();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (rec) => {
    setTogglingId(rec.id);
    try {
      await api.put(`/recurring/${rec.id}`, { active: rec.active ? false : true });
      toast.success(rec.active ? 'Paused' : 'Reactivated');
      await loadRecurring();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTogglingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/recurring/${deleteTarget.id}`);
      toast.success('Recurring transaction deleted');
      setDeleteTarget(null);
      await loadRecurring();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Recurring</h1>
          <p className="text-gray-500 text-sm">
            Templates that automatically create transactions on a schedule.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 transition-colors"
        >
          + Add recurring
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : recurring.length === 0 ? (
        <p className="text-gray-500">
          No recurring transactions yet — add one to schedule automatic entries.
        </p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/50 text-gray-400">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Category</th>
                <th className="text-left px-4 py-2 font-medium">Schedule</th>
                <th className="text-left px-4 py-2 font-medium">Next due</th>
                <th className="text-right px-4 py-2 font-medium">Amount</th>
                <th className="text-center px-4 py-2 font-medium">Active</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recurring.map((rec) => (
                <tr key={rec.id} className={`border-t border-gray-800 ${rec.active ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-2 text-gray-300 whitespace-nowrap">
                    {rec.category_icon} {rec.category_name || '—'}
                    {rec.description ? <span className="text-gray-500"> · {rec.description}</span> : null}
                  </td>
                  <td className="px-4 py-2 text-gray-400 whitespace-nowrap">{describeFrequency(rec)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(rec.next_due)}</td>
                  <td
                    className={`px-4 py-2 text-right font-medium whitespace-nowrap ${
                      rec.type === 'earning' ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {rec.type === 'earning' ? '+' : '-'}
                    {formatCents(rec.amount)}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => toggleActive(rec)}
                      disabled={togglingId === rec.id}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                        rec.active ? 'bg-emerald-600' : 'bg-gray-600'
                      }`}
                      aria-label={rec.active ? 'Pause' : 'Reactivate'}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          rec.active ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                    <button onClick={() => openEdit(rec)} className="text-emerald-400 hover:text-emerald-300">
                      Edit
                    </button>
                    <button onClick={() => setDeleteTarget(rec)} className="text-red-400 hover:text-red-300">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-md w-full">
            <h2 className="font-semibold text-lg mb-4">
              {editing ? 'Edit recurring transaction' : 'Add recurring transaction'}
            </h2>
            <RecurringForm
              initial={editing}
              categories={categories}
              submitting={submitting}
              onSubmit={handleSubmit}
              onCancel={() => {
                setShowForm(false);
                setEditing(null);
              }}
            />
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-sm w-full">
            <h2 className="font-semibold text-lg mb-2">Delete this recurring transaction?</h2>
            <p className="text-sm text-gray-400 mb-4">
              {describeFrequency(deleteTarget)} — {formatCents(deleteTarget.amount)}. This stops future
              occurrences. Transactions already created stay in your ledger.
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
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
