import React, { useMemo, useState } from 'react';
import { formatCents } from '../../lib/format.js';
import { colorForCategory } from './palette.js';
import ChartCard from './ChartCard.jsx';

const COLUMNS = [
  { key: 'category_name', label: 'Category', align: 'left' },
  { key: 'earnings', label: 'Earnings', align: 'right' },
  { key: 'spending', label: 'Spending', align: 'right' },
  { key: 'net', label: 'Net', align: 'right' },
];

// Merges the raw per-(category, type) rows from /api/stats/categories into
// one row per category, since a `both`-type category can appear twice
// (once as earning, once as spending) and the table shows both columns.
function mergeByCategory(categories) {
  const map = new Map();
  for (const row of categories || []) {
    const existing = map.get(row.category_id) || {
      category_id: row.category_id,
      category_name: row.category_name,
      category_icon: row.category_icon,
      category_color: row.category_color,
      earnings: 0,
      spending: 0,
    };
    if (row.type === 'earning') existing.earnings += row.total;
    if (row.type === 'spending') existing.spending += row.total;
    map.set(row.category_id, existing);
  }
  return Array.from(map.values()).map((r) => ({ ...r, net: r.earnings - r.spending }));
}

export default function CategoryBreakdownTable({ categories }) {
  const [sortKey, setSortKey] = useState('spending');
  const [sortDir, setSortDir] = useState('desc');

  const rows = useMemo(() => mergeByCategory(categories), [categories]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const totals = rows.reduce(
    (acc, r) => ({ earnings: acc.earnings + r.earnings, spending: acc.spending + r.spending }),
    { earnings: 0, spending: 0 }
  );

  const toggleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  return (
    <ChartCard
      title="Category breakdown"
      subtitle="Selected month"
      isEmpty={rows.length === 0}
      emptyMessage="No transactions recorded for this month yet."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-[12.5px]">
          <thead>
            <tr className="border-b-2 border-cream/[.18]">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`xp-eyebrow-dim cursor-pointer select-none whitespace-nowrap pb-2.5 transition-colors hover:text-cream ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.label}
                  {sortKey === col.key && <span className="ml-1 text-lime">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="xp-num font-medium">
            {sorted.map((r, i) => (
              <tr key={r.category_id} className="border-b border-cream-hair">
                <td className="py-[11px] pr-3">
                  <span className="flex items-center gap-2.5">
                    <span
                      className="h-2.5 w-2.5 flex-none"
                      style={{ backgroundColor: colorForCategory(r, i) }}
                    />
                    {r.category_icon} {r.category_name}
                  </span>
                </td>
                <td className={`py-[11px] text-right ${r.earnings > 0 ? 'text-lime' : 'text-cream-faint'}`}>
                  {r.earnings > 0 ? formatCents(r.earnings) : '—'}
                </td>
                <td className={`py-[11px] text-right font-bold ${r.spending > 0 ? '' : 'text-cream-faint'}`}>
                  {r.spending > 0 ? formatCents(r.spending) : '—'}
                </td>
                <td className={`py-[11px] text-right font-bold ${r.net >= 0 ? 'text-lime' : 'text-brick-light'}`}>
                  {r.net >= 0 ? '+' : '−'}
                  {formatCents(Math.abs(r.net))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="xp-num">
            <tr className="border-t-2 border-cream/[.18] font-extrabold">
              <td className="py-[11px] uppercase tracking-[.08em] text-[10px]">Total</td>
              <td className="py-[11px] text-right text-lime">{formatCents(totals.earnings)}</td>
              <td className="py-[11px] text-right">{formatCents(totals.spending)}</td>
              <td
                className={`py-[11px] text-right ${
                  totals.earnings - totals.spending >= 0 ? 'text-lime' : 'text-brick-light'
                }`}
              >
                {formatCents(totals.earnings - totals.spending)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ChartCard>
  );
}
