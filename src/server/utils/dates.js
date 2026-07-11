// All date logic must respect the app timezone (TZ env var, e.g. Europe/Lisbon).
// We use Intl APIs (no extra deps) to compute the "local" calendar date in that zone,
// regardless of the host machine's own timezone.

const TZ = process.env.TZ || 'Europe/Lisbon';

/**
 * Returns today's date as YYYY-MM-DD in the app timezone.
 */
export function todayLocalDate() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA locale formats as YYYY-MM-DD
  return formatter.format(new Date());
}

/**
 * Returns the current YYYY-MM (year-month) in the app timezone.
 */
export function currentLocalMonth() {
  return todayLocalDate().slice(0, 7);
}

/**
 * Validates a date string is a well-formed YYYY-MM-DD date.
 */
export function isValidDateString(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime());
}

/**
 * Returns true if the given YYYY-MM-DD date string is after today (local).
 */
export function isFutureDate(dateStr) {
  return dateStr > todayLocalDate();
}
