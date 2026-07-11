import React from 'react';

function shiftMonth(monthStr, delta) {
  const [year, month] = monthStr.split('-').map(Number);
  const zeroBased = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = (zeroBased % 12) + 1;
  return `${String(newYear).padStart(4, '0')}-${String(newMonth).padStart(2, '0')}`;
}

function monthLabel(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Month navigator: prev/next arrows plus the month label. `next` is disabled
// once the current calendar month is reached — Phase 2 has no future data.
export default function MonthPicker({ month, currentMonth, onChange }) {
  const atCurrent = month >= currentMonth;

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => onChange(shiftMonth(month, -1))}
        aria-label="Previous month"
        className="rounded-lg bg-gray-800 hover:bg-gray-700 px-3 py-1.5 text-sm transition-colors"
      >
        ←
      </button>
      <span className="text-gray-200 font-medium min-w-[9rem] text-center">{monthLabel(month)}</span>
      <button
        onClick={() => !atCurrent && onChange(shiftMonth(month, 1))}
        disabled={atCurrent}
        aria-label="Next month"
        className="rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-1.5 text-sm transition-colors"
      >
        →
      </button>
      {!atCurrent && (
        <button
          onClick={() => onChange(currentMonth)}
          className="text-xs text-emerald-400 hover:text-emerald-300 ml-1"
        >
          Today
        </button>
      )}
    </div>
  );
}
