import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { formatCents, formatDate } from '../lib/format.js';
import TransactionForm from '../components/TransactionForm.jsx';

const emptyFilters = { type: '', category_id: '', date_from: '', date_to: '' };

export default function Transactions() {
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [filters, setFilters] = useState(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadCategories = () => api.get('/categories').then(setCategories);

  const loadTransactions = (page = 1) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.type) params.set('type', filters.type);
    if (filters.category_id) params.set('category_id', filters.category_id);
    if (filters.date_from) params.set('date_from', filters.date_from);
    if (filters.date_to) params.set('date_to', filters.date_to);
    params.set('page', page);
    params.set('page_size', 20);

    return api
      .get(`/transactions?${params.toString()}`)
      .then((res) => {
        setTransactions(res.data);
        setPagination(res.pagination);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCategories().catch((err) => toast.error(err.message));
  }, []);

  useEffect(() => {
    loadTransactions(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const openCreate = () => {
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (tx) => {
    setEditing(tx);
    setShowForm(true);
  };

  const handleSubmit = async (payload) => {
    setSubmitting(true);
    try {
      if (editing) {
        await api.put(`/transactions/${editing.id}`, payload);
        toast.success('Transaction updated');
      } else {
        await api.post('/transactions', payload);
        toast.success('Transaction added');
      }
      setShowForm(false);
      setEditing(null);
      await loadTransactions(pagination.page);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/transactions/${deleteTarget.id}`);
      toast.success('Transaction deleted');
      setDeleteTarget(null);
      await loadTransactions(pagination.page);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[clamp(22px,2.6vw,28px)] font-extrabold tracking-tighter">Transactions</h1>
        <button
          onClick={openCreate}
          className="rounded-lg bg-lime-mid hover:bg-[#7aab5c] text-white text-sm font-medium px-4 py-2 transition-colors"
        >
          + Add transaction
        </button>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <select
          value={filters.type}
          onChange={(e) => setFilters({ ...filters, type: e.target.value })}
          className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm"
        >
          <option value="">All types</option>
          <option value="earning">Earning</option>
          <option value="spending">Spending</option>
        </select>
        <select
          value={filters.category_id}
          onChange={(e) => setFilters({ ...filters, category_id: e.target.value })}
          className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={filters.date_from}
          onChange={(e) => setFilters({ ...filters, date_from: e.target.value })}
          className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={filters.date_to}
          onChange={(e) => setFilters({ ...filters, date_to: e.target.value })}
          className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm"
        />
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 text-gray-400">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-left px-4 py-2 font-medium">Description</th>
                  <th className="text-left px-4 py-2 font-medium">Category</th>
                  <th className="text-right px-4 py-2 font-medium">Amount</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                      No transactions found.
                    </td>
                  </tr>
                )}
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-t border-gray-800">
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(tx.date)}</td>
                    <td className="px-4 py-2 text-gray-300">
                      {tx.recurring_id != null && (
                        <span
                          className="mr-1.5 text-emerald-400"
                          title="Created from a recurring transaction"
                          aria-label="Recurring"
                        >
                          🔁
                        </span>
                      )}
                      {tx.description || '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-400">
                      {tx.category_icon} {tx.category_name}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-medium whitespace-nowrap ${
                        tx.type === 'earning' ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {tx.type === 'earning' ? '+' : '-'}
                      {formatCents(tx.amount)}
                    </td>
                    <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                      <button onClick={() => openEdit(tx)} className="text-emerald-400 hover:text-emerald-300">
                        Edit
                      </button>
                      <button onClick={() => setDeleteTarget(tx)} className="text-red-400 hover:text-red-300">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
            </span>
            <div className="space-x-2">
              <button
                disabled={pagination.page <= 1}
                onClick={() => loadTransactions(pagination.page - 1)}
                className="rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 px-3 py-1.5"
              >
                Previous
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => loadTransactions(pagination.page + 1)}
                className="rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 px-3 py-1.5"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-md w-full">
            <h2 className="font-semibold text-lg mb-4">{editing ? 'Edit transaction' : 'Add transaction'}</h2>
            <TransactionForm
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
            <h2 className="font-semibold text-lg mb-2">Delete this transaction?</h2>
            <p className="text-sm text-gray-400 mb-4">
              {formatDate(deleteTarget.date)} — {deleteTarget.description || 'No description'} —{' '}
              {formatCents(deleteTarget.amount)}
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
