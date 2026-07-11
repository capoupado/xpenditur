import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { formatCents, formatDate, describeFrequency } from '../lib/format.js';
import MonthPicker from '../components/MonthPicker.jsx';
import CategoryDonutChart from '../components/Charts/CategoryDonutChart.jsx';
import TrendBarChart from '../components/Charts/TrendBarChart.jsx';
import DailySpendingLineChart from '../components/Charts/DailySpendingLineChart.jsx';
import CategoryBreakdownTable from '../components/Charts/CategoryBreakdownTable.jsx';
import BudgetProgress from '../components/BudgetProgress.jsx';

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
  const [budgetStatus, setBudgetStatus] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  const [loading, setLoading] = useState(true);

  // Upcoming recurring transactions in the next 7 days — template-based (reads
  // next_due), independent of the selected month, so load it once on mount.
  useEffect(() => {
    api
      .get('/recurring/upcoming?days=7')
      .then((res) => setUpcoming(res.upcoming))
      .catch((err) => toast.error(err.message));
  }, []);

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
      api.get(`/budgets/status?month=${month}`),
    ])
      .then(([monthlyRes, categoriesRes, trendsRes, budgetStatusRes]) => {
        setMonthly(monthlyRes);
        setCategoryStats(categoriesRes);
        setTrends(trendsRes);
        setBudgetStatus(budgetStatusRes);
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

          {upcoming?.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="font-semibold text-gray-200">Upcoming recurring</h2>
                <span className="text-xs bg-emerald-600/20 text-emerald-400 rounded-full px-2 py-0.5">
                  {upcoming.length} in next 7 days
                </span>
              </div>
              <ul className="divide-y divide-gray-800">
                {upcoming.map((rec) => (
                  <li key={rec.id} className="flex items-center justify-between py-2 text-sm">
                    <div className="min-w-0">
                      <span className="text-gray-200">
                        {rec.category_icon} {rec.category_name || '—'}
                      </span>
                      <span className="text-gray-500">
                        {' '}
                        · {describeFrequency(rec)} · due {formatDate(rec.next_due)}
                      </span>
                    </div>
                    <span
                      className={`font-medium whitespace-nowrap ${
                        rec.type === 'earning' ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {rec.type === 'earning' ? '+' : '-'}
                      {formatCents(rec.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CategoryDonutChart categories={categoryStats?.categories} />
            <DailySpendingLineChart dailySpending={monthly.dailySpending} />
          </div>

          <TrendBarChart months={trends?.months} />

          {budgetStatus?.budgets?.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="font-semibold text-gray-200 mb-4">Budgets this month</h2>
              <div className="space-y-4">
                {budgetStatus.budgets.map((status) => (
                  <BudgetProgress key={status.category_id} status={status} />
                ))}
              </div>
            </div>
          )}

          <CategoryBreakdownTable categories={categoryStats?.categories} />
        </div>
      )}
    </div>
  );
}
