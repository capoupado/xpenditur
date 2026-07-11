// Amounts are stored as integer cents; display as €XX.XX.
export function formatCents(cents) {
  const value = (cents ?? 0) / 100;
  return `€${value.toFixed(2)}`;
}

// Dates are stored as YYYY-MM-DD; display as DD/MM/YYYY (European).
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

// Returns today's date as YYYY-MM-DD in the browser's local timezone.
// (The server is the source of truth for TZ-aware validation; this is only
// used to pre-fill/limit the date input in the UI.)
export function todayInputValue() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
