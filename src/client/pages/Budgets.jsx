import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { formatCents } from '../lib/format.js';
import MonthPicker from '../components/MonthPicker.jsx';

const BUDGETABLE_TYPES = ['spending', 'both'];

// scope: 'default' (month IS NULL, applies every month) or 'month' (this page's selected month).
const emptyForm = { id: null, category_id: '', amount: '', scope: 'default' };

function centsToInputValue(cents) {
  return cents === '' || cents === null || cents === undefined ? '' : String(cents / 100);
}

function inputValueToCents(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return NaN;
  return Math.round(num * 100);
}

export default function Budgets() {
  const [categories, setCategories] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [month, setMonth] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    api
      .get('/stats/monthly')
      .then((res) => {
        setCurrentMonth(res.month);
        setMonth(res.month);
      })
      .catch((err) => toast.error(err.message));
  }, []);

  const load = () => {
    setLoading(true);
    return Promise.all([api.get('/categories'), api.get('/budgets')])
      .then(([cats, budgetRows]) => {
        setCategories(cats.filter((c) => BUDGETABLE_TYPES.includes(c.type)));
        setBudgets(budgetRows);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    return categories.map((cat) => {
      const catBudgets = budgets.filter((b) => b.category_id === cat.id);
      const defaultBudget = catBudgets.find((b) => b.month === null) || null;
      const monthBudget = month ? catBudgets.find((b) => b.month === month) || null : null;
      return { category: cat, defaultBudget, monthBudget };
    });
  }, [categories, budgets, month]);

  const openCreate = (category, scope) => {
    setForm({ id: null, category_id: category.id, amount: '', scope });
    setShowForm(true);
  };

  const openEdit = (budget, scope) => {
    setForm({ id: budget.id, category_id: budget.category_id, amount: centsToInputValue(budget.amount), scope });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setForm(emptyForm);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cents = inputValueToCents(form.amount);
    if (!Number.isInteger(cents) || cents <= 0) {
      toast.error('Amount must be a positive number');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        category_id: Number(form.category_id),
        amount: cents,
        month: form.scope === 'default' ? null : month,
      };
      if (form.id) {
        await api.put(`/budgets/${form.id}`, payload);
        toast.success('Budget updated');
      } else {
        await api.post('/budgets', payload);
        toast.success('Budget created');
      }
      closeForm();
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/budgets/${deleteTarget.id}`);
      toast.success('Budget deleted');
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const formCategory = categories.find((c) => c.id === Number(form.category_id));

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[clamp(22px,2.6vw,28px)] font-extrabold tracking-tighter mb-1">Budgets</h1>
          <p className="text-gray-500 text-sm">
            Set a default monthly limit per category, and override it for specific months.
          </p>
        </div>
        {month && currentMonth && <MonthPicker month={month} currentMonth={currentMonth} onChange={setMonth} />}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500">
          No spending categories yet — create one on the Categories page to set a budget for it.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map(({ category, defaultBudget, monthBudget }) => (
            <div
              key={category.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4"
            >
              <div className="flex items-center gap-2 sm:w-48 shrink-0">
                <span
                  className="inline-block w-3 h-3 rounded-full"
                  style={{ backgroundColor: category.color || '#6b7280' }}
                />
                <span className="font-medium">
                  {category.icon} {category.name}
                </span>
              </div>

              {/* Default budget */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-xs uppercase tracking-wide text-gray-500 border border-gray-700 rounded px-1.5 py-0.5 shrink-0">
                  default
                </span>
                {defaultBudget ? (
                  <>
                    <span className="text-gray-200">{formatCents(defaultBudget.amount)}/mo</span>
                    <button
                      onClick={() => openEdit(defaultBudget, 'default')}
                      className="text-emerald-400 hover:text-emerald-300 text-sm ml-2"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteTarget(defaultBudget)}
                      className="text-red-400 hover:text-red-300 text-sm"
                    >
                      Delete
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => openCreate(category, 'default')}
                    className="text-sm text-gray-400 hover:text-gray-200"
                  >
                    + Set default budget
                  </button>
                )}
              </div>

              {/* Month override for the selected month */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-xs uppercase tracking-wide text-emerald-400 border border-emerald-700 rounded px-1.5 py-0.5 shrink-0">
                  override this month
                </span>
                {monthBudget ? (
                  <>
                    <span className="text-gray-200">{formatCents(monthBudget.amount)}</span>
                    <button
                      onClick={() => openEdit(monthBudget, 'month')}
                      className="text-emerald-400 hover:text-emerald-300 text-sm ml-2"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteTarget(monthBudget)}
                      className="text-red-400 hover:text-red-300 text-sm"
                    >
                      Delete
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => openCreate(category, 'month')}
                    className="text-sm text-gray-400 hover:text-gray-200"
                  >
                    + Override this month
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-sm w-full">
            <h2 className="font-semibold text-lg mb-1">
              {form.id ? 'Edit budget' : 'New budget'} — {formCategory?.icon} {formCategory?.name}
            </h2>
            <p className="text-sm text-gray-400 mb-4">
              {form.scope === 'default'
                ? 'Applies every month unless overridden.'
                : `Overrides the default for ${month} only.`}
            </p>
            <form onSubmit={handleSubmit}>
              <label className="block text-xs text-gray-500 mb-1">Monthly limit (€)</label>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                autoFocus
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm mb-4 focus:outline-none focus:border-lime"
                placeholder="250.00"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-medium px-4 py-2 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-lime-mid hover:bg-[#7aab5c] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
                >
                  {form.id ? 'Save changes' : 'Create budget'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-sm w-full">
            <h2 className="font-semibold text-lg mb-2">Delete this budget?</h2>
            <p className="text-sm text-gray-400 mb-4">
              {deleteTarget.month === null
                ? 'This is a default budget — categories without a month override will have no limit afterwards.'
                : `This removes the override for ${deleteTarget.month}; the default budget (if any) will apply again.`}
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
