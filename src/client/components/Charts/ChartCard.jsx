import React from 'react';

// Shared chrome for every chart panel: eyebrow + title, responsive body, and
// a friendly empty state when there's nothing to plot (never a crash).
export default function ChartCard({ title, subtitle, isEmpty, emptyMessage, action, children }) {
  return (
    <section className="xp-panel">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          {subtitle && <div className="xp-eyebrow">{subtitle}</div>}
          <h2 className="xp-title mt-1">{title}</h2>
        </div>
        {action}
      </div>
      {isEmpty ? (
        <div className="flex h-56 items-center justify-center px-4 text-center text-sm text-cream-muted">
          {emptyMessage || 'No data for this period.'}
        </div>
      ) : (
        children
      )}
    </section>
  );
}
