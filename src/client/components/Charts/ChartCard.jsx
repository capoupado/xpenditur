import React from 'react';

// Shared card chrome for every chart: title, fixed-height responsive body,
// and a friendly empty state when there's no data to plot (never a crash).
export default function ChartCard({ title, subtitle, isEmpty, emptyMessage, children }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-5">
      <div className="mb-3">
        <h2 className="font-semibold text-gray-100">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {isEmpty ? (
        <div className="h-56 flex items-center justify-center text-sm text-gray-500 text-center px-4">
          {emptyMessage || 'No data for this period.'}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
