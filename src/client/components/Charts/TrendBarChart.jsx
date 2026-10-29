import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCents } from '../../lib/format.js';
import ChartCard from './ChartCard.jsx';
import { EARNING_COLOR, SPENDING_COLOR, AXIS_COLOR, GRID_COLOR } from './palette.js';

function monthLabel(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1))
    .toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
    .toUpperCase();
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-cream-line bg-ink-panel px-3 py-2 text-sm shadow-xl backdrop-blur-xl">
      <p className="mb-1 font-bold text-cream">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="xp-num" style={{ color: entry.fill }}>
          {entry.name}: {formatCents(entry.value)}
        </p>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex gap-4 text-[11px] font-semibold text-cream-dim">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 bg-lime" />
        Earnings
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 bg-brick" />
        Spending
      </span>
    </div>
  );
}

// Earnings vs spending grouped bar chart across several months.
// `months` is the /api/stats/trends response array: [{ month, totalEarnings, totalSpending }]
export default function TrendBarChart({ months }) {
  const hasData = (months || []).some((m) => m.totalEarnings > 0 || m.totalSpending > 0);
  const data = (months || []).map((m) => ({
    month: monthLabel(m.month),
    Earnings: m.totalEarnings,
    Spending: m.totalSpending,
  }));

  return (
    <ChartCard
      title="Earnings vs spending"
      subtitle={`Last ${data.length} months`}
      action={<Legend />}
      isEmpty={!hasData}
      emptyMessage="No transactions recorded in this range yet."
    >
      <div className="h-64 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={4}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis
              dataKey="month"
              stroke={AXIS_COLOR}
              fontSize={9.5}
              fontWeight={700}
              letterSpacing=".08em"
              tickLine={false}
              axisLine={{ stroke: 'rgba(242,232,207,.18)', strokeWidth: 2 }}
            />
            <YAxis
              stroke={AXIS_COLOR}
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatCents(v)}
              width={66}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(242,232,207,0.05)' }} />
            <Bar dataKey="Earnings" fill={EARNING_COLOR} maxBarSize={18} />
            <Bar dataKey="Spending" fill={SPENDING_COLOR} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
