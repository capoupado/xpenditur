import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';

const TYPES = ['earning', 'spending', 'both'];

const emptyForm = { id: null, name: '', type: 'spending', icon: '', color: '#6b7280' };

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // category pending delete confirmation
  const [reassignTo, setReassignTo] = useState('');

  const load = () => {
    setLoading(true);
    return api
      .get('/categories')
      .then(setCategories)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const startEdit = (cat) => {
    setForm({ id: cat.id, name: cat.name, type: cat.type, icon: cat.icon || '', color: cat.color || '#6b7280' });
  };

  const resetForm = () => setForm(emptyForm);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: form.name, type: form.type, icon: form.icon || null, color: form.color || null };
      if (form.id) {
        await api.put(`/categories/${form.id}`, payload);
        toast.success('Category updated');
      } else {
        await api.post('/categories', payload);
        toast.success('Category created');
      }
      resetForm();
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const requestDelete = (cat) => {
    if (cat.is_system) {
      toast.error('"Other" is a protected system category and cannot be deleted');
      return;
    }
    setDeleteTarget(cat);
    setReassignTo('');
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const qs = reassignTo ? `?reassign_to=${reassignTo}` : '';
      await api.delete(`/categories/${deleteTarget.id}${qs}`);
      toast.success('Category deleted');
      setDeleteTarget(null);
      await load();
    } catch (err) {
      if (err.body?.transactionCount) {
        toast.error('This category has transactions — choose a destination category to reassign them.');
      } else {
        toast.error(err.message);
      }
    }
  };

  const otherOptions = categories.filter((c) => c.id !== deleteTarget?.id);

  return (
    <div>
      <h1 className="text-[clamp(22px,2.6vw,28px)] font-extrabold tracking-tighter mb-6">Categories</h1>

      <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <div className="sm:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Name</label>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime"
            placeholder="e.g. Groceries"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Type</label>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Icon</label>
          <input
            value={form.icon}
            onChange={(e) => setForm({ ...form, icon: e.target.value })}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime"
            placeholder="🛒"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Color</label>
          <input
            type="color"
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
            className="w-full h-10 rounded-lg bg-gray-800 border border-gray-700"
          />
        </div>
        <div className="flex gap-2 sm:col-span-4">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-lime-mid hover:bg-[#7aab5c] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
          >
            {form.id ? 'Save changes' : 'Add category'}
          </button>
          {form.id && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-medium px-4 py-2 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/50 text-gray-400">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.id} className="border-t border-gray-800">
                  <td className="px-4 py-2 flex items-center gap-2">
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{ backgroundColor: cat.color || '#6b7280' }}
                    />
                    <span>{cat.icon} {cat.name}</span>
                    {cat.is_system === 1 && (
                      <span className="text-xs text-gray-500 border border-gray-700 rounded px-1.5 py-0.5">system</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-400">{cat.type}</td>
                  <td className="px-4 py-2 text-right space-x-3">
                    <button onClick={() => startEdit(cat)} className="text-emerald-400 hover:text-emerald-300">
                      Edit
                    </button>
                    <button
                      onClick={() => requestDelete(cat)}
                      disabled={cat.is_system === 1}
                      className="text-red-400 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-sm w-full">
            <h2 className="font-semibold text-lg mb-2">Delete "{deleteTarget.name}"?</h2>
            <p className="text-sm text-gray-400 mb-4">
              If this category has transactions, choose a category to reassign them to. Its budgets and recurring
              transactions will be removed.
            </p>
            <select
              value={reassignTo}
              onChange={(e) => setReassignTo(e.target.value)}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm mb-4 focus:outline-none focus:border-lime"
            >
              <option value="">No reassignment needed</option>
              {otherOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
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
