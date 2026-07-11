import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { formatCents } from '../lib/format.js';
import MonthPicker from '../components/MonthPicker.jsx';
import CategoryDonutChart from '../components/Charts/CategoryDonutChart.jsx';
import TrendBarChart from '../components/Charts/TrendBarChart.jsx';
import DailySpendingLineChart from '../components/Charts/DailySpendingLineChart.jsx';
import CategoryBreakdownTable from '../components/Charts/CategoryBreakdownTable.jsx';

function SummaryCard({ label, value, tone }) {
  const toneClasses = {
    positive: 'text-emerald-400',
    negative: 'text-red-400',
    neutral: 'text-gray-100',
  };
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-sm text-gray-500 mb-2">{label}</p>
      <p className={`text-3xl font-bold ${toneClasses[tone] || toneClasses.neutral}`}>{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const [month, setMonth] = useState(null); // null until we learn the server's current month
  const [currentMonth, setCurrentMonth] = useState(null);
  const [monthly, setMonthly] = useState(null);
  const [categoryStats, setCategoryStats] = useState(null);
  const [trends, setTrends] = useState(null);
  const [loading, setLoading] = useState(true);

  // First load: ask the server what "this month" is (TZ-aware), then use it
  // both as the initial selection and as the ceiling for month navigation.
  useEffect(() => {
    api
      .get('/stats/monthly')
      .then((res) => {
        setCurrentMonth(res.month);
        setMonth(res.month);
      })
      .catch((err) => toast.error(err.message));
  }, []);

  useEffect(() => {
    if (!month) return;
    setLoading(true);
    Promise.all([
      api.get(`/stats/monthly?month=${month}`),
      api.get(`/stats/categories?month=${month}`),
      api.get('/stats/trends?months=6'),
    ])
      .then(([monthlyRes, categoriesRes, trendsRes]) => {
        setMonthly(monthlyRes);
        setCategoryStats(categoriesRes);
        setTrends(trendsRes);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [month]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
          <p className="text-gray-500 text-sm">Monthly overview and trends</p>
        </div>
        {month && currentMonth && <MonthPicker month={month} currentMonth={currentMonth} onChange={setMonth} />}
      </div>

      {loading || !monthly ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SummaryCard label="Total Earnings" value={formatCents(monthly.totalEarnings)} tone="positive" />
            <SummaryCard label="Total Spending" value={formatCents(monthly.totalSpending)} tone="negative" />
            <SummaryCard
              label="Balance"
              value={formatCents(monthly.balance)}
              tone={monthly.balance >= 0 ? 'positive' : 'negative'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CategoryDonutChart categories={categoryStats?.categories} />
            <DailySpendingLineChart dailySpending={monthly.dailySpending} />
          </div>

          <TrendBarChart months={trends?.months} />

          <CategoryBreakdownTable categories={categoryStats?.categories} />
        </div>
      )}
    </div>
  );
}
