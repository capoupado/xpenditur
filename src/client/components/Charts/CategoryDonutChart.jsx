import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCents } from '../../lib/format.js';
import { colorForCategory } from './palette.js';
import ChartCard from './ChartCard.jsx';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="border border-cream-line bg-ink-panel px-3 py-2 text-sm shadow-xl backdrop-blur-xl">
      <p className="font-bold text-cream">
        {entry.payload.icon ? `${entry.payload.icon} ` : ''}
        {entry.name}
      </p>
      <p className="xp-num text-cream-muted">{formatCents(entry.value)}</p>
    </div>
  );
}

// Spending-by-category donut for a single month. `categories` is the raw
// /api/stats/categories response array (mixed earning + spending rows) —
// this component filters to spending itself so callers don't have to.
export default function CategoryDonutChart({ categories }) {
  const spending = (categories || [])
    .filter((c) => c.type === 'spending' && c.total > 0)
    .map((c, i) => ({
      name: c.category_name,
      icon: c.category_icon,
      value: c.total,
      color: colorForCategory(c, i),
    }));

  const total = spending.reduce((sum, c) => sum + c.value, 0);
  const ranked = spending.slice().sort((a, b) => b.value - a.value);

  return (
    <ChartCard
      title="Where it went"
      subtitle="By category"
      isEmpty={spending.length === 0}
      emptyMessage="No spending recorded for this month yet."
    >
      <div className="flex flex-wrap items-center gap-6">
        {/* Donut with the month total burned into the hole. */}
        <div className="relative h-[168px] w-[168px] flex-none drop-shadow-[0_0_16px_rgba(188,71,73,.45)]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={ranked}
                dataKey="value"
                nameKey="name"
                innerRadius="66%"
                outerRadius="94%"
                paddingAngle={ranked.length > 1 ? 1.5 : 0}
                stroke="none"
              >
                {ranked.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="xp-num text-[19px] font-extrabold tracking-tighter">{formatCents(total)}</span>
            <span className="text-[8px] font-bold tracking-[.16em] text-cream-muted">SPENT</span>
          </div>
        </div>

        <ul className="flex min-w-0 flex-1 basis-[200px] flex-col gap-px bg-cream/[.12]">
          {ranked.map((c) => (
            <li
              key={c.name}
              className="flex items-center gap-2.5 bg-ink-raised py-[5px] pl-0.5 text-xs font-medium"
            >
              <span className="h-2.5 w-2.5 flex-none" style={{ backgroundColor: c.color }} />
              <span className="truncate">
                {c.icon} {c.name}
              </span>
              <span className="xp-num ml-auto whitespace-nowrap font-bold">{formatCents(c.value)}</span>
              <span className="xp-num w-9 text-right text-cream-muted">
                {total > 0 ? `${Math.round((c.value / total) * 100)}%` : '—'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}
