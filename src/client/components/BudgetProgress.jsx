import React from 'react';
import { formatCents } from '../lib/format.js';

// Color coding: green (<60%), yellow (60-80%), orange (80-100%), red (>100%).
function toneForPercentage(pct) {
  if (pct > 100) return { bar: 'bg-red-500', text: 'text-red-400' };
  if (pct >= 80) return { bar: 'bg-orange-500', text: 'text-orange-400' };
  if (pct >= 60) return { bar: 'bg-yellow-500', text: 'text-yellow-400' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-400' };
}

// A single category's budget-vs-spend bar. `status` is one row from
// GET /api/budgets/status (category_name, budget_amount, spend, remaining, percentage, kind).
export default function BudgetProgress({ status }) {
  const { bar, text } = toneForPercentage(status.percentage);
  const width = Math.min(100, status.percentage);

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="flex items-center gap-1.5 text-gray-200">
          <span>{status.category_icon}</span>
          <span>{status.category_name}</span>
          <span
            className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border ${
              status.kind === 'month'
                ? 'border-emerald-700 text-emerald-400'
                : 'border-gray-700 text-gray-500'
            }`}
          >
            {status.kind === 'month' ? 'override' : 'default'}
          </span>
        </span>
        <span className={`font-medium ${text}`}>{status.percentage}%</span>
      </div>
      <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden">
        <div className={`h-full ${bar} transition-all`} style={{ width: `${width}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
        <span>
          {formatCents(status.spend)} of {formatCents(status.budget_amount)}
        </span>
        <span>
          {status.remaining >= 0
            ? `${formatCents(status.remaining)} left`
            : `${formatCents(-status.remaining)} over`}
        </span>
      </div>
    </div>
  );
}
