// Category suggestions learned from the user's own ledger.
//
// Bank statement lines repeat ("COMPRAS C.DEB WWW.AMA", "NOS Comunicacoes",
// "TRF CRITICAL SOFTWARE"), and once the user has categorized one, the same
// description should get the same category every time — no AI call, no
// guessing about context the model can't know (own transfers, salary). Only
// descriptions never seen before fall through to the AI provider.
//
// Matching is on a normalized description: case/accents folded and every
// token containing a digit dropped, so references, dates and amounts embedded
// in the line ("MANUTENCAO CONTA PACOTE 26.31 10/09/2026 A 09/10/2026") don't
// prevent a match.

import db from '../db.js';

export function normalizeDescription(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/\s+/)
    .filter((tok) => tok && !/\d/.test(tok))
    .join(' ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds a lookup over the ledger: `suggest(description, type)` returns
 * `{ categoryId, confidence, matches }` for the category most often used for
 * that normalized description and type (ties → most recently used), or null.
 *
 * `ignoreCategoryIds` skips catch-all categories ("Other"): having filed a
 * line under Other says nothing about where it belongs, so those rows should
 * still go to the AI.
 */
export function buildCategoryHistory({ ignoreCategoryIds = [] } = {}) {
  const ignore = new Set(ignoreCategoryIds);
  const rows = db
    .prepare(
      `SELECT description, type, category_id, COUNT(*) AS n, MAX(date) AS last_date
       FROM transactions
       WHERE description IS NOT NULL AND description != ''
       GROUP BY description, type, category_id`
    )
    .all();

  // key "type|normalized" → Map(categoryId → { n, lastDate })
  const index = new Map();
  for (const row of rows) {
    if (ignore.has(row.category_id)) continue;
    const norm = normalizeDescription(row.description);
    if (!norm) continue;
    const key = `${row.type}|${norm}`;
    if (!index.has(key)) index.set(key, new Map());
    const byCat = index.get(key);
    const prev = byCat.get(row.category_id) || { n: 0, lastDate: '' };
    byCat.set(row.category_id, {
      n: prev.n + row.n,
      lastDate: row.last_date > prev.lastDate ? row.last_date : prev.lastDate,
    });
  }

  return {
    suggest(description, type) {
      const norm = normalizeDescription(description);
      if (!norm) return null;
      const byCat = index.get(`${type}|${norm}`);
      if (!byCat) return null;
      let best = null;
      let total = 0;
      for (const [categoryId, stats] of byCat) {
        total += stats.n;
        if (!best || stats.n > best.n || (stats.n === best.n && stats.lastDate > best.lastDate)) {
          best = { categoryId, ...stats };
        }
      }
      return { categoryId: best.categoryId, confidence: best.n / total, matches: total };
    },
  };
}

export default { normalizeDescription, buildCategoryHistory };
