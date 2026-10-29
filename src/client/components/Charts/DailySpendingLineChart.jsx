import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCents, formatDate } from '../../lib/format.js';
import ChartCard from './ChartCard.jsx';
import { SPENDING_COLOR, SPENDING_LINE_COLOR, AXIS_COLOR, GRID_COLOR } from './palette.js';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-cream-line bg-ink-panel px-3 py-2 text-sm shadow-xl backdrop-blur-xl">
      <p className="font-bold text-cream">{formatDate(payload[0].payload.date)}</p>
      <p className="xp-num text-brick-light">{formatCents(payload[0].value)}</p>
    </div>
  );
}

// Daily spending trend for a single month. `dailySpending` is the
// /api/stats/monthly response field: [{ date, total }] for every day of the
// month (zero-filled), so the area always spans the full month even when
// most days have no spending.
export default function DailySpendingLineChart({ dailySpending }) {
  const hasData = (dailySpending || []).some((d) => d.total > 0);
  const data = (dailySpending || []).map((d) => ({
    date: d.date,
    day: Number(d.date.slice(8, 10)),
    total: d.total,
  }));

  // The headline is the peak day — that's the number worth reacting to.
  const peak = data.reduce((best, d) => (best && best.total >= d.total ? best : d), null);
  const title = peak && peak.total > 0 ? `Peak ${formatCents(peak.total)} on the ${peak.day}${ordinal(peak.day)}` : 'Daily trend';

  return (
    <ChartCard
      title={title}
      subtitle="Daily trend"
      isEmpty={!hasData}
      emptyMessage="No spending recorded for this month yet."
    >
      <div className="h-56 drop-shadow-[0_0_12px_rgba(188,71,73,.45)] sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="xpTrendFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={SPENDING_COLOR} stopOpacity="0.55" />
                <stop offset="1" stopColor={SPENDING_COLOR} stopOpacity="0" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis
              dataKey="day"
              stroke={AXIS_COLOR}
              fontSize={9.5}
              fontWeight={700}
              letterSpacing=".08em"
              tickLine={false}
              axisLine={{ stroke: 'rgba(242,232,207,.18)', strokeWidth: 2 }}
              interval={Math.max(0, Math.ceil(data.length / 5) - 1)}
            />
            <YAxis
              stroke={AXIS_COLOR}
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatCents(v)}
              width={66}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(242,232,207,.25)' }} />
            <Area
              type="monotone"
              dataKey="total"
              stroke={SPENDING_LINE_COLOR}
              strokeWidth={2.5}
              fill="url(#xpTrendFill)"
              dot={false}
              activeDot={{ r: 4, fill: '#f2e8cf', stroke: 'none' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function ordinal(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
}
