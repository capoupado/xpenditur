import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { formatCents } from '../lib/format.js';

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
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/stats/summary')
      .then(setSummary)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  const monthLabel = summary
    ? new Date(`${summary.month}-01T00:00:00`).toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
      })
    : '';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-gray-500 mb-6">{monthLabel}</p>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryCard label="Total Earnings" value={formatCents(summary.totalEarnings)} tone="positive" />
          <SummaryCard label="Total Spending" value={formatCents(summary.totalSpending)} tone="negative" />
          <SummaryCard
            label="Balance"
            value={formatCents(summary.balance)}
            tone={summary.balance >= 0 ? 'positive' : 'negative'}
          />
        </div>
      )}
    </div>
  );
}
