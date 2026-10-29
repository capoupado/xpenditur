import React, { useEffect, useState } from 'react';
import { todayInputValue } from '../lib/format.js';

// Controlled form for creating/editing a transaction.
// `categories` is the full category list; options are filtered by the selected type
// ("both" categories are always eligible). Defaults category to "Other" per spec.
export default function TransactionForm({ initial, categories, onSubmit, onCancel, submitting }) {
  const otherCategory = categories.find((c) => c.is_system === 1);

  const [type, setType] = useState(initial?.type || 'spending');
  const [amount, setAmount] = useState(initial ? (initial.amount / 100).toFixed(2) : '');
  const [description, setDescription] = useState(initial?.description || '');
  const [categoryId, setCategoryId] = useState(initial?.category_id || otherCategory?.id || '');
  const [date, setDate] = useState(initial?.date || todayInputValue());

  const eligibleCategories = categories.filter((c) => c.type === 'both' || c.type === type);

  useEffect(() => {
    // If the currently selected category is no longer eligible for the chosen type, fall back to "Other".
    if (categoryId && !eligibleCategories.some((c) => c.id === Number(categoryId))) {
      setCategoryId(otherCategory?.id || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount) * 100);
    onSubmit({
      type,
      amount: cents,
      description: description || null,
      category_id: Number(categoryId),
      date,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime"
          >
            <option value="spending">Spending</option>
            <option value="earning">Earning</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Amount (€)</label>
          <input
            required
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Category</label>
        <select
          required
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime"
        >
          {eligibleCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon ? `${c.icon} ` : ''}
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Date</label>
        <input
          required
          type="date"
          max={todayInputValue()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Description</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-lime"
          placeholder="Optional"
        />
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-medium px-4 py-2 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-lime-mid hover:bg-[#7aab5c] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
        >
          {initial ? 'Save changes' : 'Add transaction'}
        </button>
      </div>
    </form>
  );
}
