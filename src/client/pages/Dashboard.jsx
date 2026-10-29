import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatCents, formatDate, describeFrequency } from '../lib/format.js';
import MonthPicker from '../components/MonthPicker.jsx';
import CategoryDonutChart from '../components/Charts/CategoryDonutChart.jsx';
import TrendBarChart from '../components/Charts/TrendBarChart.jsx';
import DailySpendingLineChart from '../components/Charts/DailySpendingLineChart.jsx';
import CategoryBreakdownTable from '../components/Charts/CategoryBreakdownTable.jsx';
import BudgetProgress from '../components/BudgetProgress.jsx';

// The hero KPI: net balance, sheened and glowing, tinted by sign.
function NetBalanceCard({ balance, earnings, spending }) {
  const negative = balance < 0;
  // "Spend is 10.3× earnings" reads harder than a bare balance.
  const ratio = earnings > 0 ? spending / earnings : null;

  return (
    <div
      className="relative overflow-hidden p-5 sm:p-[22px]"
      style={{
        background: negative
          ? 'linear-gradient(155deg, rgba(188,71,73,.30), rgba(242,232,207,.04) 58%)'
          : 'linear-gradient(155deg, rgba(167,201,87,.26), rgba(242,232,207,.04) 58%)',
      }}
    >
      <div className="animate-sheen pointer-events-none absolute left-0 top-0 h-full w-[70px] bg-[linear-gradient(100deg,rgba(242,232,207,.16),rgba(242,232,207,0))]" />
      <div className="text-[10px] font-bold uppercase tracking-label text-cream-dim">Net balance</div>
      <div
        className={`xp-num mt-1.5 text-[clamp(30px,3.4vw,40px)] font-black tracking-tighter ${
          negative ? 'text-brick-light' : 'text-lime'
        }`}
        style={{ textShadow: `0 0 40px ${negative ? 'rgba(188,71,73,.7)' : 'rgba(167,201,87,.55)'}` }}
      >
        {negative ? '−' : '+'}
        {formatCents(Math.abs(balance))}
      </div>
      <div className="mt-1.5 text-xs font-medium text-cream-dim">
        {ratio !== null ? (
          <>
            Spend is{' '}
            <b className={negative ? 'text-brick-light' : 'text-lime'}>{ratio.toFixed(1)}×</b> earnings this month
          </>
        ) : spending > 0 ? (
          'No earnings recorded this month'
        ) : (
          'Nothing recorded this month yet'
        )}
      </div>
    </div>
  );
}

// Secondary KPI: a total, a proportional rule, and a count line.
function TotalCard({ label, value, tone, share, countLabel }) {
  const color = tone === 'earning' ? '#a7c957' : '#bc4749';
  return (
    <div className="p-5 sm:p-[22px]">
      <div className="text-[10px] font-bold uppercase tracking-label text-cream-muted">{label}</div>
      <div
        className="xp-num mt-2 text-[27px] font-extrabold tracking-tight"
        style={tone === 'earning' ? { color } : undefined}
      >
        {tone === 'earning' ? '+' : ''}
        {formatCents(value)}
      </div>
      <div className="mt-3.5 h-[3px] bg-cream-line">
        <div
          className="h-full"
          style={{
            width: `${Math.round(share * 100)}%`,
            backgroundColor: color,
            boxShadow: `0 0 14px ${tone === 'earning' ? 'rgba(167,201,87,.8)' : 'rgba(188,71,73,.85)'}`,
          }}
        />
      </div>
      <div className="mt-2 text-[11px] font-medium text-cream-faint">{countLabel}</div>
    </div>
  );
}

// Compact stat used inside the insight strip.
function MiniStat({ label, value, tone }) {
  return (
    <div className="bg-ink-panel px-4 py-1.5">
      <div className="text-[9.5px] font-bold uppercase tracking-label text-cream-faint">{label}</div>
      <div className={`xp-num text-base font-extrabold ${tone === 'negative' ? 'text-brick-light' : ''}`}>
        {value}
      </div>
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
  const [recent, setRecent] = useState(null);
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
      // Latest activity in the selected month — the first page is already
      // sorted date DESC, id DESC, so page_size is the whole story.
      api.get(`/transactions?date_from=${month}-01&date_to=${month}-31&page_size=5`),
    ])
      .then(([monthlyRes, categoriesRes, trendsRes, budgetStatusRes, recentRes]) => {
        setMonthly(monthlyRes);
        setCategoryStats(categoriesRes);
        setTrends(trendsRes);
        setBudgetStatus(budgetStatusRes);
        setRecent(recentRes);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [month]);

  const rows = categoryStats?.categories || [];
  const spendRows = rows.filter((c) => c.type === 'spending' && c.total > 0);
  const earnRows = rows.filter((c) => c.type === 'earning' && c.total > 0);

  // Everything below is derived from data already on the page — no extra calls.
  const derived = useMemo(() => {
    if (!monthly) return null;
    const days = monthly.dailySpending || [];
    const isCurrent = month === currentMonth;
    const todayIso = new Date().toISOString().slice(0, 10);
    const todayRow = days.find((d) => d.date === todayIso);
    const lastSeven = days.filter((d) => d.date <= todayIso).slice(-7);
    const weekTotal = lastSeven.reduce((s, d) => s + d.total, 0);

    const elapsed = isCurrent && days.length ? Math.min(100, Math.round((Number(todayIso.slice(8, 10)) / days.length) * 100)) : null;
    const daysLeft = elapsed !== null ? days.length - Number(todayIso.slice(8, 10)) : null;

    const total = monthly.totalSpending;
    const top = spendRows.slice().sort((a, b) => b.total - a.total)[0];
    const topShare = top && total > 0 ? Math.round((top.total / total) * 100) : null;

    return {
      isCurrent,
      today: todayRow ? todayRow.total : null,
      weekTotal: isCurrent ? weekTotal : null,
      elapsed,
      daysLeft,
      top,
      topShare,
    };
  }, [monthly, month, currentMonth, categoryStats]);

  const topBudget = budgetStatus?.budgets?.slice().sort((a, b) => b.percentage - a.percentage)[0];
  const totalFlow = (monthly?.totalSpending || 0) + (monthly?.totalEarnings || 0);

  return (
    <>
      <header className="xp-rule flex flex-wrap items-end justify-between gap-3.5 pb-3.5">
        <div>
          <div className="xp-eyebrow">
            Monthly overview{spendRows.length + earnRows.length > 0 && ` — ${rows.length} active categories`}
          </div>
          <h1 className="mt-1.5 text-[clamp(24px,3vw,30px)] font-extrabold tracking-tighter">Dashboard</h1>
        </div>
        {month && currentMonth && <MonthPicker month={month} currentMonth={currentMonth} onChange={setMonth} />}
      </header>

      {loading || !monthly ? (
        <p className="py-10 text-sm text-cream-muted">Loading…</p>
      ) : (
        <>
          {/* Pace strip — budget pressure and where the month stands. */}
          {(topBudget || (derived && derived.elapsed !== null)) && (
            <div className="xp-slab flex flex-wrap">
              {topBudget && (
                <div className="min-w-0 flex-1 basis-[200px] px-[18px] py-3.5">
                  <div className="flex justify-between xp-eyebrow-dim">
                    <span className="truncate">{topBudget.category_name} budget</span>
                    <span className="text-lime">{topBudget.percentage}%</span>
                  </div>
                  <div className="mt-2.5 h-1.5 bg-cream-line">
                    <div
                      className="h-full bg-lime shadow-[0_0_14px_rgba(167,201,87,.7)]"
                      style={{ width: `${Math.min(100, topBudget.percentage)}%` }}
                    />
                  </div>
                  <div className="xp-num mt-2 text-xs font-medium text-cream-dim">
                    {formatCents(topBudget.spend)} of {formatCents(topBudget.budget_amount)} —{' '}
                    {topBudget.remaining >= 0
                      ? `${formatCents(topBudget.remaining)} left`
                      : `${formatCents(-topBudget.remaining)} over`}
                  </div>
                </div>
              )}
              {derived && derived.elapsed !== null && (
                <div className="min-w-0 flex-1 basis-[200px] px-[18px] py-3.5">
                  <div className="flex justify-between xp-eyebrow-dim">
                    <span>Month elapsed</span>
                    <span>{derived.elapsed}%</span>
                  </div>
                  <div className="mt-2.5 h-1.5 bg-cream-line">
                    <div className="h-full bg-sand" style={{ width: `${derived.elapsed}%` }} />
                  </div>
                  <div className="mt-2 text-xs font-medium text-cream-dim">
                    {derived.daysLeft > 0 ? `${derived.daysLeft} days to close the month` : 'Last day of the month'}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* KPI slab */}
          <div className="xp-slab grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            <NetBalanceCard
              balance={monthly.balance}
              earnings={monthly.totalEarnings}
              spending={monthly.totalSpending}
            />
            <TotalCard
              label="Total spending"
              value={monthly.totalSpending}
              tone="spending"
              share={totalFlow > 0 ? monthly.totalSpending / totalFlow : 0}
              countLabel={`${spendRows.length} categories`}
            />
            <TotalCard
              label="Total earnings"
              value={monthly.totalEarnings}
              tone="earning"
              share={totalFlow > 0 ? monthly.totalEarnings / totalFlow : 0}
              countLabel={`${earnRows.length} categories`}
            />
          </div>

          {/* Insight strip */}
          {derived?.top && (
            <div className="flex flex-wrap items-center gap-4 border border-cream-line bg-cream/[.045] px-[18px] py-3 shadow-[inset_0_1px_0_rgba(242,232,207,.12)] backdrop-blur-[22px]">
              <span className="bg-brick px-2 py-1 text-[9.5px] font-extrabold uppercase tracking-[.12em] text-cream">
                Insight
              </span>
              <span className="text-[13.5px] font-medium text-cream/[.86] [text-wrap:pretty]">
                <b className="text-white">
                  {derived.top.category_icon} {derived.top.category_name}
                </b>{' '}
                is {derived.topShare}% of spend — your biggest single line this month.
              </span>
              {derived.isCurrent && (
                <div className="ml-auto flex gap-px bg-cream-line">
                  <MiniStat label="This week" value={`−${formatCents(derived.weekTotal)}`} tone="negative" />
                  <MiniStat
                    label="Today"
                    value={derived.today ? `−${formatCents(derived.today)}` : '—'}
                    tone={derived.today ? 'negative' : 'neutral'}
                  />
                </div>
              )}
            </div>
          )}

          {upcoming?.length > 0 && (
            <section className="xp-panel">
              <div className="mb-3.5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="xp-eyebrow">Next 7 days</div>
                  <h2 className="xp-title mt-1">Upcoming recurring</h2>
                </div>
                <span className="bg-lime/[.16] px-2 py-1 text-[9.5px] font-extrabold uppercase tracking-[.12em] text-lime">
                  {upcoming.length} scheduled
                </span>
              </div>
              <ul>
                {upcoming.map((rec) => (
                  <li
                    key={rec.id}
                    className="flex items-center justify-between gap-3 border-b border-cream-hair py-2.5 text-[12.5px] last:border-0"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">
                        {rec.category_icon} {rec.category_name || '—'}
                      </span>
                      <span className="text-cream-muted">
                        {' '}
                        · {describeFrequency(rec)} · due {formatDate(rec.next_due)}
                      </span>
                    </div>
                    <span
                      className={`xp-num whitespace-nowrap font-bold ${
                        rec.type === 'earning' ? 'text-lime' : 'text-brick-light'
                      }`}
                    >
                      {rec.type === 'earning' ? '+' : '−'}
                      {formatCents(rec.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="xp-panel">
            <div className="mb-3.5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="xp-eyebrow">Latest activity</div>
                <h2 className="xp-title mt-1">Recent transactions</h2>
              </div>
              <Link
                to="/transactions"
                className="text-[10px] font-bold uppercase tracking-label text-cream-dim hover:text-cream"
              >
                View all →
              </Link>
            </div>
            {recent?.data?.length > 0 ? (
              <ul>
                {recent.data.map((tx) => (
                  <li
                    key={tx.id}
                    className="flex items-center justify-between gap-3 border-b border-cream-hair py-2.5 text-[12.5px] last:border-0"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">
                        {tx.category_icon} {tx.category_name}
                      </span>
                      <span className="text-cream-muted">
                        {' '}
                        · {formatDate(tx.date)}
                        {tx.description ? ` · ${tx.description}` : ''}
                      </span>
                    </div>
                    <span
                      className={`xp-num whitespace-nowrap font-bold ${
                        tx.type === 'earning' ? 'text-lime' : 'text-brick-light'
                      }`}
                    >
                      {tx.type === 'earning' ? '+' : '−'}
                      {formatCents(tx.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-cream-muted">No transactions this month yet.</p>
            )}
          </section>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3.5">
            <CategoryDonutChart categories={categoryStats?.categories} />
            <DailySpendingLineChart dailySpending={monthly.dailySpending} />
          </div>

          <TrendBarChart months={trends?.months} />

          {budgetStatus?.budgets?.length > 0 && (
            <section className="xp-panel">
              <div className="xp-eyebrow">This month</div>
              <h2 className="xp-title mb-4 mt-1">Budgets</h2>
              <div className="space-y-4">
                {budgetStatus.budgets.map((status) => (
                  <BudgetProgress key={status.category_id} status={status} />
                ))}
              </div>
            </section>
          )}

          <CategoryBreakdownTable categories={categoryStats?.categories} />
        </>
      )}
    </>
  );
}
