import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { formatCents } from '../../lib/format.js';
import ChartCard from './ChartCard.jsx';

const EARNING_COLOR = '#34d399'; // emerald-400, matches the app's existing positive tone
const SPENDING_COLOR = '#f87171'; // red-400, matches the app's existing negative tone

function monthLabel(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm shadow-lg">
      <p className="text-gray-100 font-medium mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} style={{ color: entry.fill }}>
          {entry.name}: {formatCents(entry.value)}
        </p>
      ))}
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
      isEmpty={!hasData}
      emptyMessage="No transactions recorded in this range yet."
    >
      <div className="h-64 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis dataKey="month" stroke="#6b7280" fontSize={12} tickLine={false} axisLine={{ stroke: '#374151' }} />
            <YAxis
              stroke="#6b7280"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatCents(v)}
              width={70}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
            <Bar dataKey="Earnings" fill={EARNING_COLOR} radius={[4, 4, 0, 0]} maxBarSize={36} />
            <Bar dataKey="Spending" fill={SPENDING_COLOR} radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
