import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatCents, formatDate } from '../lib/format.js';

const CADENCE_LABELS = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

const EXAMPLE_QUESTIONS = [
  'How much did I spend on food this year vs last year?',
  'What were my 5 biggest spendings last month?',
  'Average monthly net over the last 6 months?',
  'Everything from Uber is actually Transport',
];

function signed(cents) {
  return `${cents < 0 ? '−' : '+'}${formatCents(Math.abs(cents))}`;
}

function SectionHeader({ eyebrow, title, aside }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="xp-eyebrow">{eyebrow}</div>
        <h2 className="xp-title mt-1">{title}</h2>
      </div>
      {aside}
    </div>
  );
}

function Pill({ children, tone = 'lime' }) {
  const tones = {
    lime: 'bg-lime/[.16] text-lime',
    brick: 'bg-brick/[.22] text-brick-light',
    amber: 'bg-amber/[.18] text-amber',
    muted: 'bg-cream-line text-cream-muted',
  };
  return (
    <span className={`whitespace-nowrap px-2 py-1 text-[9.5px] font-extrabold uppercase tracking-[.12em] ${tones[tone]}`}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Ask your ledger
// ---------------------------------------------------------------------------

// A recategorization the AI proposed. Nothing is written until Apply; after
// applying, Undo restores each transaction's previous category.
function ChangeProposal({ proposal, onDone }) {
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(null); // { updated, pendingUpdated, undo }
  const { transactions, category } = proposal;

  const apply = async () => {
    setBusy(true);
    try {
      const res = await api.post('/insights/apply', {
        changes: transactions.map((t) => ({ id: t.id, category_id: category.id })),
      });
      setApplied(res);
      toast.success(
        `${res.updated} transaction${res.updated === 1 ? '' : 's'} moved to ${category.name}` +
          (res.pendingUpdated ? `, ${res.pendingUpdated} pending row(s) too` : '')
      );
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    setBusy(true);
    try {
      if (applied.undo.length) await api.post('/insights/apply', { changes: applied.undo });
      toast.success('Change undone');
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const notes = [
    proposal.alreadyThere > 0 && `${proposal.alreadyThere} already in ${category.name}`,
    proposal.typeMismatch > 0 && `${proposal.typeMismatch} skipped (wrong type for that category)`,
  ].filter(Boolean);

  return (
    <div className="mt-4 border border-lime/30 bg-lime/[.05] p-4">
      <div className="xp-eyebrow">Proposed change</div>
      <p className="mt-1 text-[14px] text-cream">
        {proposal.summary} — <b>{transactions.length}</b> transaction{transactions.length === 1 ? '' : 's'} →{' '}
        {category.icon} {category.name}
      </p>
      {notes.length > 0 && <p className="mt-1 text-xs text-cream-muted">{notes.join(' · ')}</p>}

      {transactions.length > 0 && (
        <div className="mt-3 max-h-72 overflow-auto border border-cream-line">
          <table className="w-full text-xs">
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-t border-cream-hair first:border-t-0">
                  <td className="whitespace-nowrap px-3 py-1.5 text-cream-muted">{formatDate(t.date)}</td>
                  <td className="px-3 py-1.5 text-cream-dim">{t.description || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-cream-muted">{t.category_name}</td>
                  <td className="xp-num whitespace-nowrap px-3 py-1.5 text-right text-cream-dim">
                    {signed(t.type === 'earning' ? t.amount : -t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {!applied ? (
          <>
            <button onClick={onDone} disabled={busy} className="border border-cream-line px-3 py-1.5 text-xs font-bold text-cream-muted hover:text-cream">
              Cancel
            </button>
            <button onClick={apply} disabled={busy || transactions.length === 0} className="xp-btn-primary disabled:opacity-50">
              {busy ? 'Applying…' : `Apply to ${transactions.length}`}
            </button>
          </>
        ) : (
          <button onClick={undo} disabled={busy} className="border border-cream-line px-3 py-1.5 text-xs font-bold text-cream hover:bg-cream-film">
            {busy ? 'Undoing…' : 'Undo'}
          </button>
        )}
      </div>
    </div>
  );
}

function AskPanel() {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState(null);
  const [showData, setShowData] = useState(false);

  const ask = async (q) => {
    const text = (q ?? question).trim();
    if (!text) return;
    setQuestion(text);
    setAsking(true);
    setResult(null);
    setShowData(false);
    try {
      setResult(await api.post('/insights/ask', { question: text }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAsking(false);
    }
  };

  return (
    <section className="xp-panel">
      <SectionHeader eyebrow="AI" title="Ask your ledger" aside={<span className="text-xs text-cream-muted">Ask questions, or fix categories: “XYZ is actually Other”</span>} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder="e.g. How much did I spend on restaurants in Q3 vs Q2?"
          className="xp-input flex-1"
        />
        <button type="submit" disabled={asking || !question.trim()} className="xp-btn-primary disabled:opacity-50">
          {asking ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      {!result && !asking && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => ask(q)}
              className="border border-cream-line px-2.5 py-1 text-xs text-cream-muted transition-colors hover:border-lime hover:text-cream"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {result?.proposal && <ChangeProposal proposal={result.proposal} onDone={() => setResult(null)} />}

      {result && !result.proposal && (
        <div className="mt-4">
          <p className="whitespace-pre-line text-[14px] leading-relaxed text-cream [text-wrap:pretty]">{result.answer}</p>
          {result.sql && (
            <>
              <button
                onClick={() => setShowData((v) => !v)}
                className="mt-3 text-[10px] font-bold uppercase tracking-label text-cream-dim hover:text-cream"
              >
                {showData ? 'Hide data ↑' : `Show data (${result.rows.length} rows) ↓`}
              </button>
              {showData && (
                <div className="mt-2 space-y-2">
                  <pre className="overflow-x-auto border border-cream-line bg-ink-panel p-3 text-[11px] text-cream-dim">
                    {result.sql}
                  </pre>
                  {result.rows.length > 0 && (
                    <div className="max-h-80 overflow-auto border border-cream-line">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-ink-panel text-cream-muted">
                          <tr>
                            {result.columns.map((c) => (
                              <th key={c} className="px-3 py-1.5 text-left font-medium">
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((row, i) => (
                            <tr key={i} className="border-t border-cream-hair">
                              {result.columns.map((c) => (
                                <td key={c} className="xp-num px-3 py-1.5 text-cream-dim">
                                  {row[c] === null ? '—' : String(row[c])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Month-end forecast
// ---------------------------------------------------------------------------

function ForecastPanel({ forecast }) {
  const { totals } = forecast;
  const negative = totals.projectedNet < 0;
  return (
    <section className="xp-panel">
      <SectionHeader
        eyebrow={`${forecast.daysLeft} days left`}
        title="Month-end forecast"
        aside={<Pill tone={negative ? 'brick' : 'lime'}>Net {signed(totals.projectedNet)}</Pill>}
      />
      <p className="mb-4 text-xs text-cream-muted [text-wrap:pretty]">
        Recorded so far, plus what's scheduled (recurring templates and detected regular payments), plus your usual
        variable spending for the remaining days.
      </p>

      <div className="xp-slab mb-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
        {[
          ['Spent so far', formatCents(totals.spent)],
          ['Still scheduled', formatCents(totals.scheduledSpending)],
          ['Variable estimate', formatCents(totals.variableSpending)],
          ['Projected spending', formatCents(totals.projectedSpending)],
          ['Projected earnings', formatCents(totals.projectedEarning)],
        ].map(([label, value]) => (
          <div key={label} className="px-4 py-3">
            <div className="xp-eyebrow-dim">{label}</div>
            <div className="xp-num mt-1 text-lg font-extrabold">{value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="text-cream-muted">
            <tr>
              <th className="py-2 pr-3 text-left font-medium">Category</th>
              <th className="px-3 py-2 text-right font-medium">Spent</th>
              <th className="px-3 py-2 text-right font-medium">Scheduled</th>
              <th className="px-3 py-2 text-right font-medium">Variable</th>
              <th className="px-3 py-2 text-right font-medium">Projected</th>
              <th className="py-2 pl-3 text-right font-medium">Budget</th>
            </tr>
          </thead>
          <tbody>
            {forecast.categories
              .filter((c) => c.projectedSpending > 0)
              .map((c) => (
                <tr key={c.category_id} className="border-t border-cream-hair">
                  <td className="py-2 pr-3 font-medium">
                    {c.category_icon} {c.category_name}
                  </td>
                  <td className="xp-num px-3 py-2 text-right text-cream-dim">{formatCents(c.spent)}</td>
                  <td className="xp-num px-3 py-2 text-right text-cream-dim">{c.scheduled ? formatCents(c.scheduled) : '—'}</td>
                  <td className="xp-num px-3 py-2 text-right text-cream-dim">{c.variable ? formatCents(c.variable) : '—'}</td>
                  <td className="xp-num px-3 py-2 text-right font-bold">{formatCents(c.projectedSpending)}</td>
                  <td className="xp-num py-2 pl-3 text-right">
                    {c.budget == null ? (
                      <span className="text-cream-faint">—</span>
                    ) : c.projectedOverBudget > 0 ? (
                      <span className="font-bold text-brick-light">{formatCents(c.projectedOverBudget)} over</span>
                    ) : (
                      <span className="text-lime">{formatCents(-c.projectedOverBudget)} spare</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {forecast.scheduled.length > 0 && (
        <>
          <div className="xp-eyebrow-dim mb-1 mt-5">Still to come this month</div>
          <ul>
            {forecast.scheduled.map((s, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 border-b border-cream-hair py-2 text-[12.5px] last:border-0"
              >
                <div className="min-w-0 truncate">
                  <span className="font-medium">{s.description || s.category_name}</span>
                  <span className="text-cream-muted">
                    {' '}
                    · {formatDate(s.date)} · {s.source === 'recurring' ? 'recurring' : 'expected'}
                  </span>
                </div>
                <span className={`xp-num whitespace-nowrap font-bold ${s.type === 'earning' ? 'text-lime' : 'text-brick-light'}`}>
                  {s.type === 'earning' ? '+' : '−'}
                  {formatCents(s.amount)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Regular payments (subscription radar)
// ---------------------------------------------------------------------------

function RegularPanel({ series }) {
  const spending = series.filter((s) => s.type === 'spending');
  const active = spending.filter((s) => !s.stopped);
  const stopped = spending.filter((s) => s.stopped);
  const yearly = active.reduce((sum, s) => sum + s.yearlyCost, 0);
  const untracked = active.filter((s) => !s.tracked).length;

  return (
    <section className="xp-panel">
      <SectionHeader
        eyebrow="Detected from your ledger"
        title="Regular payments"
        aside={active.length > 0 && <Pill tone="muted">≈ {formatCents(yearly)} / year</Pill>}
      />
      {spending.length === 0 ? (
        <p className="text-sm text-cream-muted">
          Nothing regular found yet — this needs a few months of transactions with descriptions (bank sync or imports).
        </p>
      ) : (
        <>
          {untracked > 0 && (
            <p className="mb-3 text-xs text-cream-muted [text-wrap:pretty]">
              {untracked} of these {untracked === 1 ? "isn't" : "aren't"} a{' '}
              <Link to="/recurring" className="text-cream-dim underline hover:text-cream">
                recurring template
              </Link>{' '}
              yet — they're still counted in the forecast.
            </p>
          )}
          <ul>
            {[...active, ...stopped].map((s) => (
              <li
                key={`${s.type}-${s.description}`}
                className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-cream-hair py-2.5 text-[12.5px] last:border-0 ${
                  s.stopped ? 'opacity-55' : ''
                }`}
              >
                <div className="min-w-0 flex-1 basis-[240px]">
                  <div className="truncate font-medium">{s.description}</div>
                  <div className="text-cream-muted">
                    {s.category_icon} {s.category_name} · {CADENCE_LABELS[s.cadence]} · {s.count} charges ·{' '}
                    {s.stopped ? `last ${formatDate(s.lastDate)}` : `next ≈ ${formatDate(s.nextExpected)}`}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {s.stopped && <Pill tone="muted">Stopped?</Pill>}
                  {s.priceChange && (
                    <Pill tone={s.priceChange.to > s.priceChange.from ? 'brick' : 'lime'}>
                      {formatCents(s.priceChange.from)} → {formatCents(s.priceChange.to)}
                    </Pill>
                  )}
                  {s.variableAmount && <Pill tone="muted">Varies</Pill>}
                  {!s.tracked && !s.stopped && <Pill tone="amber">No template</Pill>}
                </div>
                <div className="xp-num w-[110px] text-right">
                  <div className="font-bold text-brick-light">−{formatCents(s.typicalAmount)}</div>
                  {!s.stopped && <div className="text-[11px] text-cream-faint">{formatCents(s.yearlyCost)}/yr</div>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default function Insights() {
  const [forecast, setForecast] = useState(null);
  const [series, setSeries] = useState(null);

  useEffect(() => {
    api
      .get('/insights/forecast')
      .then(setForecast)
      .catch((err) => toast.error(err.message));
    api
      .get('/insights/regular')
      .then((res) => setSeries(res.series))
      .catch((err) => toast.error(err.message));
  }, []);

  return (
    <>
      <header className="xp-rule pb-3.5">
        <div className="xp-eyebrow">Where the money is heading</div>
        <h1 className="mt-1.5 text-[clamp(24px,3vw,30px)] font-extrabold tracking-tighter">Insights</h1>
      </header>

      <AskPanel />
      {forecast ? <ForecastPanel forecast={forecast} /> : <p className="text-sm text-cream-muted">Loading forecast…</p>}
      {series && <RegularPanel series={series} />}
    </>
  );
}
