import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

const VALID_TYPES = ['earning', 'spending', 'both'];

function validateCategoryInput(body, { partial = false } = {}) {
  const errors = [];
  if (!partial || body.name !== undefined) {
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      errors.push('name is required');
    }
  }
  if (!partial || body.type !== undefined) {
    if (!VALID_TYPES.includes(body.type)) {
      errors.push(`type must be one of ${VALID_TYPES.join(', ')}`);
    }
  }
  return errors;
}

router.get('/', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY is_system DESC, name ASC').all();
  res.json(categories);
});

router.post('/', (req, res) => {
  const errors = validateCategoryInput(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const { name, type, icon = null, color = null } = req.body;
  try {
    const info = db
      .prepare('INSERT INTO categories (name, type, icon, color, is_system) VALUES (?, ?, ?, ?, 0)')
      .run(name.trim(), type, icon, color);
    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(category);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A category with this name already exists' });
    }
    throw err;
  }
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  const errors = validateCategoryInput(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const name = req.body.name !== undefined ? req.body.name.trim() : category.name;
  const type = req.body.type !== undefined ? req.body.type : category.type;
  const icon = req.body.icon !== undefined ? req.body.icon : category.icon;
  const color = req.body.color !== undefined ? req.body.color : category.color;

  // "Other" is protected: cosmetic edits allowed, but type/is_system cannot change.
  if (category.is_system && type !== category.type) {
    return res.status(400).json({ error: 'The type of a protected system category cannot be changed' });
  }

  // A category's type cannot change if it would leave existing transactions mismatched.
  if (type !== category.type) {
    let mismatchQuery;
    if (type === 'both') {
      mismatchQuery = null; // both matches everything, no mismatch possible
    } else {
      mismatchQuery = db
        .prepare('SELECT COUNT(*) AS c FROM transactions WHERE category_id = ? AND type != ?')
        .get(id, type).c;
    }
    if (mismatchQuery) {
      return res.status(400).json({
        error: `Cannot change category type to "${type}": ${mismatchQuery} existing transaction(s) would no longer match.`,
      });
    }
  }

  try {
    db.prepare('UPDATE categories SET name = ?, type = ?, icon = ?, color = ? WHERE id = ?').run(
      name,
      type,
      icon,
      color,
      id
    );
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A category with this name already exists' });
    }
    throw err;
  }

  const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  if (category.is_system) {
    return res.status(400).json({ error: '"Other" is a protected system category and cannot be deleted' });
  }

  const reassignTo = req.query.reassign_to ? Number(req.query.reassign_to) : null;
  const usageCount = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE category_id = ?').get(id).c;

  if (usageCount > 0) {
    if (!reassignTo) {
      return res.status(400).json({
        error: 'This category has transactions. Provide ?reassign_to=<category_id> to reassign them before deleting.',
        transactionCount: usageCount,
      });
    }
    const destination = db.prepare('SELECT * FROM categories WHERE id = ?').get(reassignTo);
    if (!destination) {
      return res.status(400).json({ error: 'Destination category (reassign_to) not found' });
    }
    if (destination.id === id) {
      return res.status(400).json({ error: 'Destination category must differ from the category being deleted' });
    }
  }

  const tx = db.transaction(() => {
    if (usageCount > 0) {
      db.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?').run(reassignTo, id);
    }
    db.prepare('DELETE FROM budgets WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM recurring_transactions WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  });
  tx();

  res.json({ ok: true, reassigned: usageCount });
});

export default router;
