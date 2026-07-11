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

/**
 * Validates a YYYY-MM month string (e.g. "2026-07").
 */
export function isValidMonthString(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

/**
 * Shifts a YYYY-MM month string by `delta` months (can be negative).
 * Pure calendar arithmetic (no timezone involved — months/years are integers).
 */
export function shiftMonth(monthStr, delta) {
  const [year, month] = monthStr.split('-').map(Number);
  const zeroBased = (year * 12 + (month - 1)) + delta;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = (zeroBased % 12) + 1;
  return `${String(newYear).padStart(4, '0')}-${String(newMonth).padStart(2, '0')}`;
}

/**
 * Returns the number of days in a given YYYY-MM month.
 */
export function daysInMonthCount(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  // Day 0 of next month = last day of this month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Returns every YYYY-MM-DD date string in a given YYYY-MM month, in order.
 */
export function allDatesInMonth(monthStr) {
  const count = daysInMonthCount(monthStr);
  const dates = [];
  for (let day = 1; day <= count; day++) {
    dates.push(`${monthStr}-${String(day).padStart(2, '0')}`);
  }
  return dates;
}

/**
 * Adds `n` days (can be negative) to a YYYY-MM-DD date string.
 * Pure calendar arithmetic anchored at UTC midnight, so DST in the app
 * timezone can never shift the result off the intended calendar day.
 */
export function addDays(dateStr, n) {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * Number of whole calendar days from `fromStr` to `toStr` (positive if to > from).
 * Pure calendar arithmetic (UTC-anchored), independent of timezone/DST.
 */
export function daysBetween(fromStr, toStr) {
  const [fy, fm, fd] = fromStr.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = toStr.slice(0, 10).split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
}

/**
 * Builds a YYYY-MM-DD date from a YYYY-MM month string and a day-of-month,
 * clamping the day to the month's last day (e.g. day 31 in 2026-02 → 2026-02-28).
 * This is the "clamp doesn't stick" primitive: the caller always passes the
 * template's original anchor day, never a previously-clamped value.
 */
export function clampDayToMonth(monthStr, day) {
  const lastDay = daysInMonthCount(monthStr);
  const clamped = Math.min(day, lastDay);
  return `${monthStr}-${String(clamped).padStart(2, '0')}`;
}
