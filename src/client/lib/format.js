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

// Ordinal suffix for a day-of-month (1 → "1st", 22 → "22nd", 31 → "31st").
function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Human-readable schedule for a recurring template, e.g.
// "Daily", "Weekly on Monday", "Monthly on the 31st", "Yearly on 29 Feb".
export function describeFrequency(rec) {
  switch (rec.frequency) {
    case 'daily':
      return 'Daily';
    case 'weekly': {
      const name = WEEKDAYS[rec.day_of_week] ?? '';
      return name ? `Weekly on ${name}` : 'Weekly';
    }
    case 'monthly':
      return rec.day_of_month ? `Monthly on the ${ordinal(rec.day_of_month)}` : 'Monthly';
    case 'yearly': {
      // Month/day are stable across years; read them from next_due.
      const [, mm, dd] = rec.next_due.slice(0, 10).split('-');
      return `Yearly on ${Number(dd)} ${MONTHS[Number(mm) - 1]}`;
    }
    default:
      return rec.frequency;
  }
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
