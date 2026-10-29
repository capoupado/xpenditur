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

// Month navigator: prev/next arrows plus the month label, rendered as one
// segmented control. `next` is disabled once the current calendar month is
// reached — there is no future data.
export default function MonthPicker({ month, currentMonth, onChange }) {
  const atCurrent = month >= currentMonth;

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-0.5 border border-cream-line bg-cream/[.06] p-[3px] backdrop-blur-lg">
        <button
          onClick={() => onChange(shiftMonth(month, -1))}
          aria-label="Previous month"
          className="flex h-9 w-11 items-center justify-center text-[15px] text-cream-muted transition-colors hover:bg-cream-film hover:text-cream"
        >
          ←
        </button>
        <div className="min-w-[110px] px-3 text-center text-[12.5px] font-extrabold uppercase tracking-[.06em]">
          {monthLabel(month)}
        </div>
        <button
          onClick={() => !atCurrent && onChange(shiftMonth(month, 1))}
          disabled={atCurrent}
          aria-label="Next month"
          className={`flex h-9 w-11 items-center justify-center text-[15px] transition-colors ${
            atCurrent
              ? 'cursor-not-allowed text-cream-faint opacity-40'
              : 'bg-lime-mid text-cream shadow-[0_0_22px_rgba(106,153,78,.65)] hover:bg-[#7aab5c]'
          }`}
        >
          →
        </button>
      </div>
      {!atCurrent && (
        <button
          onClick={() => onChange(currentMonth)}
          className="text-[10px] font-extrabold uppercase tracking-label text-lime hover:text-lime-50"
        >
          Today
        </button>
      )}
    </div>
  );
}
