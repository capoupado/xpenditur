import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCents } from '../../lib/format.js';
import { colorForCategory } from './palette.js';
import ChartCard from './ChartCard.jsx';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm shadow-lg">
      <p className="text-gray-100 font-medium">
        {entry.payload.icon ? `${entry.payload.icon} ` : ''}
        {entry.name}
      </p>
      <p className="text-gray-400">{formatCents(entry.value)}</p>
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

  return (
    <ChartCard
      title="Spending by category"
      subtitle="Current selection"
      isEmpty={spending.length === 0}
      emptyMessage="No spending recorded for this month yet."
    >
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="w-full sm:w-1/2 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={spending}
                dataKey="value"
                nameKey="name"
                innerRadius="60%"
                outerRadius="90%"
                paddingAngle={spending.length > 1 ? 2 : 0}
                stroke="#111827"
                strokeWidth={2}
              >
                {spending.map((entry, idx) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="w-full sm:w-1/2 space-y-1.5 text-sm">
          {spending
            .slice()
            .sort((a, b) => b.value - a.value)
            .map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-gray-300 truncate">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="truncate">
                    {c.icon} {c.name}
                  </span>
                </span>
                <span className="text-gray-400 whitespace-nowrap">
                  {formatCents(c.value)}
                  {total > 0 && (
                    <span className="text-gray-600 ml-1">({Math.round((c.value / total) * 100)}%)</span>
                  )}
                </span>
              </li>
            ))}
        </ul>
      </div>
    </ChartCard>
  );
}
