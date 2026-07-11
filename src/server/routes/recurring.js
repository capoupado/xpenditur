import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidDateString, todayLocalDate, addDays } from '../utils/dates.js';
import { advanceDueDate } from '../services/recurring.js';

const router = express.Router();
router.use(requireAuth);

const VALID_TYPES = ['earning', 'spending'];
const VALID_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

// Validates recurring-template input. Mirrors the transactions validator, plus
// frequency-specific schedule fields. Note: next_due is a SCHEDULE, not a ledger
// entry, so future (or today) dates are allowed — unlike a transaction date.
function validateRecurringInput(body, { partial = false } = {}) {
  const errors = [];

  if (!partial || body.type !== undefined) {
    if (!VALID_TYPES.includes(body.type)) errors.push(`type must be one of ${VALID_TYPES.join(', ')}`);
  }
  if (!partial || body.amount !== undefined) {
    if (!Number.isInteger(body.amount) || body.amount <= 0) {
      errors.push('amount must be a positive integer number of cents');
    }
  }
  if (!partial || body.category_id !== undefined) {
    if (!Number.isInteger(body.category_id)) errors.push('category_id is required');
  }
  if (!partial || body.frequency !== undefined) {
    if (!VALID_FREQUENCIES.includes(body.frequency)) {
      errors.push(`frequency must be one of ${VALID_FREQUENCIES.join(', ')}`);
    }
  }
  if (!partial || body.next_due !== undefined) {
    if (!isValidDateString(body.next_due)) {
      errors.push('next_due must be a valid YYYY-MM-DD date');
    }
  }

  // Schedule fields are validated against the effective frequency (the incoming
  // one, or — on a partial edit that omits frequency — trusted to be checked
  // by the caller against the existing row). We only validate what's present here;
  // frequency-consistency is enforced in the handlers where the merged row is known.
  if (body.day_of_month !== undefined && body.day_of_month !== null) {
    if (!Number.isInteger(body.day_of_month) || body.day_of_month < 1 || body.day_of_month > 31) {
      errors.push('day_of_month must be an integer between 1 and 31');
    }
  }
  if (body.day_of_week !== undefined && body.day_of_week !== null) {
    if (!Number.isInteger(body.day_of_week) || body.day_of_week < 0 || body.day_of_week > 6) {
      errors.push('day_of_week must be an integer between 0 (Sun) and 6 (Sat)');
    }
  }

  return errors;
}

// Enforces the frequency ↔ schedule-field relationship on a fully-merged row.
function validateFrequencyFields(row) {
  if (row.frequency === 'monthly') {
    if (!Number.isInteger(row.day_of_month) || row.day_of_month < 1 || row.day_of_month > 31) {
      return 'day_of_month (1-31) is required for monthly recurring transactions';
    }
  }
  if (row.frequency === 'weekly') {
    if (!Number.isInteger(row.day_of_week) || row.day_of_week < 0 || row.day_of_week > 6) {
      return 'day_of_week (0-6) is required for weekly recurring transactions';
    }
  }
  return null;
}

function checkCategoryTypeMatch(categoryId, type) {
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!category) return 'category_id does not reference an existing category';
  if (category.type !== 'both' && category.type !== type) {
    return `category "${category.name}" is of type "${category.type}" and cannot be used for a "${type}" recurring transaction`;
  }
  return null;
}

const SELECT_WITH_CATEGORY = `
  SELECT r.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
  FROM recurring_transactions r
  LEFT JOIN categories c ON c.id = r.category_id
`;

router.get('/', (req, res) => {
  const rows = db
    .prepare(`${SELECT_WITH_CATEGORY} ORDER BY r.active DESC, r.next_due ASC, r.id ASC`)
    .all();
  res.json(rows);
});

// Templates whose next_due falls within the next `days` days (default 7),
// active only. Template-based (reads next_due); nothing is materialised.
router.get('/upcoming', (req, res) => {
  const days = Math.min(366, Math.max(1, parseInt(req.query.days, 10) || 7));
  const today = todayLocalDate();
  const until = addDays(today, days);
  const rows = db
    .prepare(
      `${SELECT_WITH_CATEGORY}
       WHERE r.active = 1 AND r.next_due >= ? AND r.next_due <= ?
       ORDER BY r.next_due ASC, r.id ASC`
    )
    .all(today, until);
  res.json({ from: today, until, days, upcoming: rows });
});

router.post('/', (req, res) => {
  const errors = validateRecurringInput(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const {
    type,
    amount,
    description = null,
    category_id,
    frequency,
    next_due,
  } = req.body;

  let day_of_month = req.body.day_of_month === undefined ? null : req.body.day_of_month;
  let day_of_week = req.body.day_of_week === undefined ? null : req.body.day_of_week;

  // For yearly templates the anchor day lives in day_of_month so that Feb-29
  // schedules re-expand in leap years (clamp doesn't stick). Derive it from
  // next_due when the client doesn't supply one.
  if (frequency === 'yearly' && (day_of_month === null || day_of_month === undefined)) {
    day_of_month = Number(next_due.slice(8, 10));
  }
  // Normalise irrelevant schedule fields to NULL so they can't mislead later.
  if (frequency !== 'monthly' && frequency !== 'yearly') day_of_month = null;
  if (frequency !== 'weekly') day_of_week = null;

  const freqError = validateFrequencyFields({ frequency, day_of_month, day_of_week });
  if (freqError) return res.status(400).json({ error: freqError });

  const typeError = checkCategoryTypeMatch(category_id, type);
  if (typeError) return res.status(400).json({ error: typeError });

  const info = db
    .prepare(
      `INSERT INTO recurring_transactions
         (type, amount, description, category_id, frequency, day_of_month, day_of_week, next_due, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(type, amount, description, category_id, frequency, day_of_month, day_of_week, next_due);

  const created = db
    .prepare(`${SELECT_WITH_CATEGORY} WHERE r.id = ?`)
    .get(info.lastInsertRowid);
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Recurring transaction not found' });

  const errors = validateRecurringInput(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  // Merge incoming fields over the existing row.
  const type = req.body.type !== undefined ? req.body.type : existing.type;
  const amount = req.body.amount !== undefined ? req.body.amount : existing.amount;
  const description = req.body.description !== undefined ? req.body.description : existing.description;
  const category_id = req.body.category_id !== undefined ? req.body.category_id : existing.category_id;
  const frequency = req.body.frequency !== undefined ? req.body.frequency : existing.frequency;
  let next_due = req.body.next_due !== undefined ? req.body.next_due : existing.next_due;
  let day_of_month = req.body.day_of_month !== undefined ? req.body.day_of_month : existing.day_of_month;
  let day_of_week = req.body.day_of_week !== undefined ? req.body.day_of_week : existing.day_of_week;

  // Derive/normalise schedule fields for the effective frequency.
  if (frequency === 'yearly' && (day_of_month === null || day_of_month === undefined)) {
    day_of_month = Number(next_due.slice(8, 10));
  }
  if (frequency !== 'monthly' && frequency !== 'yearly') day_of_month = null;
  if (frequency !== 'weekly') day_of_week = null;

  const freqError = validateFrequencyFields({ frequency, day_of_month, day_of_week });
  if (freqError) return res.status(400).json({ error: freqError });

  const typeError = checkCategoryTypeMatch(category_id, type);
  if (typeError) return res.status(400).json({ error: typeError });

  // Reactivation: if a paused template is switched back on and its next_due is
  // now in the past, advance it to a non-past occurrence WITHOUT materialising
  // the paused stretch — per immutable-history, those occurrences never happened.
  const activeRaw = req.body.active;
  const active =
    activeRaw === undefined ? existing.active : activeRaw === true || activeRaw === 1 ? 1 : 0;

  if (active === 1 && existing.active === 0) {
    const today = todayLocalDate();
    const merged = { frequency, day_of_month, day_of_week };
    let guard = 0;
    while (next_due < today) {
      next_due = advanceDueDate(next_due, merged);
      if (++guard > 200 * 366) break; // safety valve
    }
  }

  db.prepare(
    `UPDATE recurring_transactions
       SET type = ?, amount = ?, description = ?, category_id = ?, frequency = ?,
           day_of_month = ?, day_of_week = ?, next_due = ?, active = ?
     WHERE id = ?`
  ).run(type, amount, description, category_id, frequency, day_of_month, day_of_week, next_due, active, id);

  const updated = db.prepare(`${SELECT_WITH_CATEGORY} WHERE r.id = ?`).get(id);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Recurring transaction not found' });

  // FK: transactions.recurring_id ON DELETE SET NULL — past materialised
  // transactions survive untouched with their provenance link nulled.
  db.prepare('DELETE FROM recurring_transactions WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
