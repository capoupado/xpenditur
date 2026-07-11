import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCents, formatDate } from '../../lib/format.js';
import ChartCard from './ChartCard.jsx';

const LINE_COLOR = '#3987e5'; // categorical slot 1 (blue) — single series, no legend needed

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm shadow-lg">
      <p className="text-gray-100 font-medium">{formatDate(payload[0].payload.date)}</p>
      <p className="text-gray-400">{formatCents(payload[0].value)}</p>
    </div>
  );
}

// Daily spending trend for a single month. `dailySpending` is the
// /api/stats/monthly response field: [{ date, total }] for every day of the
// month (zero-filled), so the line always spans the full month even when
// most days have no spending.
export default function DailySpendingLineChart({ dailySpending }) {
  const hasData = (dailySpending || []).some((d) => d.total > 0);
  const data = (dailySpending || []).map((d) => ({
    date: d.date,
    day: Number(d.date.slice(8, 10)),
    total: d.total,
  }));

  return (
    <ChartCard
      title="Daily spending trend"
      subtitle="Selected month"
      isEmpty={!hasData}
      emptyMessage="No spending recorded for this month yet."
    >
      <div className="h-56 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis
              dataKey="day"
              stroke="#6b7280"
              fontSize={12}
              tickLine={false}
              axisLine={{ stroke: '#374151' }}
              interval={Math.max(0, Math.ceil(data.length / 10) - 1)}
            />
            <YAxis
              stroke="#6b7280"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatCents(v)}
              width={70}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="total"
              stroke={LINE_COLOR}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
