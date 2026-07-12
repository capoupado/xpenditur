import React, { useEffect, useState } from 'react';
import { todayInputValue } from '../lib/format.js';

const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const WEEK_OF_MONTH_OPTIONS = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: -1, label: 'Last' },
];

// Controlled form for creating/editing a recurring template.
// Unlike a transaction, next_due is a schedule and MAY be in the future/today.
export default function RecurringForm({ initial, categories, onSubmit, onCancel, submitting }) {
  const otherCategory = categories.find((c) => c.is_system === 1);

  const [type, setType] = useState(initial?.type || 'spending');
  const [amount, setAmount] = useState(initial ? (initial.amount / 100).toFixed(2) : '');
  const [description, setDescription] = useState(initial?.description || '');
  const [categoryId, setCategoryId] = useState(initial?.category_id || otherCategory?.id || '');
  const [frequency, setFrequency] = useState(initial?.frequency || 'monthly');
  // Monthly has two sub-modes: a fixed day of the month, or "Nth/last weekday".
  const [monthlyMode, setMonthlyMode] = useState(initial?.week_of_month != null ? 'weekday' : 'day');
  const [dayOfMonth, setDayOfMonth] = useState(
    initial?.day_of_month != null ? String(initial.day_of_month) : '1'
  );
  const [dayOfWeek, setDayOfWeek] = useState(
    initial?.day_of_week != null ? String(initial.day_of_week) : '1'
  );
  const [weekOfMonth, setWeekOfMonth] = useState(
    initial?.week_of_month != null ? String(initial.week_of_month) : '-1'
  );
  const [nextDue, setNextDue] = useState(initial?.next_due || todayInputValue());

  const eligibleCategories = categories.filter((c) => c.type === 'both' || c.type === type);

  useEffect(() => {
    if (categoryId && !eligibleCategories.some((c) => c.id === Number(categoryId))) {
      setCategoryId(otherCategory?.id || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const isMonthlyWeekday = frequency === 'monthly' && monthlyMode === 'weekday';

  const handleSubmit = (e) => {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount) * 100);
    const payload = {
      type,
      amount: cents,
      description: description || null,
      category_id: Number(categoryId),
      frequency,
      // Weekday mode derives its own next_due server-side from the rule.
      next_due: isMonthlyWeekday ? null : nextDue,
      day_of_month: frequency === 'monthly' && monthlyMode === 'day' ? Number(dayOfMonth) : null,
      day_of_week: frequency === 'weekly' || isMonthlyWeekday ? Number(dayOfWeek) : null,
      week_of_month: isMonthlyWeekday ? Number(weekOfMonth) : null,
    };
    onSubmit(payload);
  };

  const inputCls =
    'w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
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
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Category</label>
        <select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
          {eligibleCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon ? `${c.icon} ` : ''}
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Frequency</label>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={inputCls}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>

        {frequency === 'monthly' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Repeat by</label>
            <select value={monthlyMode} onChange={(e) => setMonthlyMode(e.target.value)} className={inputCls}>
              <option value="day">Day of month</option>
              <option value="weekday">Weekday (e.g. last Friday)</option>
            </select>
          </div>
        )}

        {frequency === 'weekly' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Day of week</label>
            <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} className={inputCls}>
              {WEEKDAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {frequency === 'monthly' && monthlyMode === 'day' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Day of month (1–31)</label>
          <input
            required
            type="number"
            min="1"
            max="31"
            step="1"
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(e.target.value)}
            className={inputCls}
          />
        </div>
      )}

      {isMonthlyWeekday && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Which</label>
            <select value={weekOfMonth} onChange={(e) => setWeekOfMonth(e.target.value)} className={inputCls}>
              {WEEK_OF_MONTH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Weekday</label>
            <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} className={inputCls}>
              {WEEKDAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {isMonthlyWeekday ? (
        <p className="text-xs text-gray-500">
          The next due date is computed automatically from the rule (first upcoming occurrence).
        </p>
      ) : (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Next due date</label>
          <input
            required
            type="date"
            value={nextDue}
            onChange={(e) => setNextDue(e.target.value)}
            className={inputCls}
          />
          {frequency === 'monthly' && (
            <p className="text-xs text-gray-500 mt-1">
              Days beyond a short month clamp to its last day (e.g. the 31st → Feb 28).
            </p>
          )}
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-500 mb-1">Description</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputCls}
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
          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
        >
          {initial ? 'Save changes' : 'Add recurring'}
        </button>
      </div>
    </form>
  );
}
