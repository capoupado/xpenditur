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
      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="w-full text-sm min-w-[420px]">
          <thead className="text-gray-400">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`px-4 py-2 font-medium cursor-pointer select-none whitespace-nowrap hover:text-gray-200 ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.label}
                  {sortKey === col.key && <span className="ml-1 text-gray-500">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.category_id} className="border-t border-gray-800">
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: colorForCategory(r, i) }}
                    />
                    {r.category_icon} {r.category_name}
                  </span>
                </td>
                <td className="px-4 py-2 text-right text-emerald-400">
                  {r.earnings > 0 ? formatCents(r.earnings) : '—'}
                </td>
                <td className="px-4 py-2 text-right text-red-400">
                  {r.spending > 0 ? formatCents(r.spending) : '—'}
                </td>
                <td className={`px-4 py-2 text-right font-medium ${r.net >= 0 ? 'text-gray-100' : 'text-red-400'}`}>
                  {formatCents(r.net)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-700 font-semibold">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right text-emerald-400">{formatCents(totals.earnings)}</td>
              <td className="px-4 py-2 text-right text-red-400">{formatCents(totals.spending)}</td>
              <td className="px-4 py-2 text-right">{formatCents(totals.earnings - totals.spending)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ChartCard>
  );
}
