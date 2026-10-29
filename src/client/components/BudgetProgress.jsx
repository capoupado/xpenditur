import React from 'react';
import { formatCents } from '../lib/format.js';

// Color coding: lime (<60%), sand (60-80%), amber (80-100%), brick (>100%).
// The bar carries a matching glow so status reads at a glance in the dark UI.
function toneForPercentage(pct) {
  if (pct > 100) return { bar: '#bc4749', text: 'text-brick-light', glow: 'rgba(188,71,73,.85)' };
  if (pct >= 80) return { bar: '#d99a4e', text: 'text-amber', glow: 'rgba(217,154,78,.7)' };
  if (pct >= 60) return { bar: '#cbbf9a', text: 'text-sand', glow: 'rgba(203,191,154,.55)' };
  return { bar: '#a7c957', text: 'text-lime', glow: 'rgba(167,201,87,.7)' };
}

// A single category's budget-vs-spend bar. `status` is one row from
// GET /api/budgets/status (category_name, budget_amount, spend, remaining, percentage, kind).
export default function BudgetProgress({ status }) {
  const { bar, text, glow } = toneForPercentage(status.percentage);
  const width = Math.min(100, status.percentage);

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="flex items-center gap-2 xp-eyebrow-dim">
          <span className="text-sm">{status.category_icon}</span>
          <span>{status.category_name}</span>
          <span
            className={`border px-1.5 py-0.5 text-[9px] ${
              status.kind === 'month' ? 'border-lime-deep text-lime' : 'border-cream-line text-cream-faint'
            }`}
          >
            {status.kind === 'month' ? 'override' : 'default'}
          </span>
        </span>
        <span className={`xp-num text-[10px] font-extrabold tracking-label ${text}`}>{status.percentage}%</span>
      </div>
      <div className="h-1.5 w-full bg-cream-line">
        <div
          className="h-full transition-all"
          style={{ width: `${width}%`, backgroundColor: bar, boxShadow: `0 0 14px ${glow}` }}
        />
      </div>
      <div className="xp-num mt-2 flex items-center justify-between text-xs font-medium text-cream-muted">
        <span>
          {formatCents(status.spend)} of {formatCents(status.budget_amount)}
        </span>
        <span className={status.remaining >= 0 ? '' : 'text-brick-light'}>
          {status.remaining >= 0
            ? `${formatCents(status.remaining)} left`
            : `${formatCents(-status.remaining)} over`}
        </span>
      </div>
    </div>
  );
}
