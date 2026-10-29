// Insights endpoints: month-end forecast, regular-payment radar, and
// "ask your ledger" (natural-language questions answered by the configured AI
// provider over a read-only copy of the ledger).

import express from 'express';
import Database from 'better-sqlite3';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { todayLocalDate } from '../utils/dates.js';
import { forecastCurrentMonth, detectRegularSeries } from '../services/insights.js';
import { getAiConfig, callAiChat } from '../services/ai-client.js';
import { parseExtractionResponse } from '../services/ai-response.js';

const router = express.Router();
router.use(requireAuth);

router.get('/forecast', (req, res) => {
  res.json(forecastCurrentMonth());
});

router.get('/regular', (req, res) => {
  const series = detectRegularSeries().map(({ transactionIds, key, ...s }) => s);
  res.json({ series });
});

// ---------------------------------------------------------------------------
// POST /api/insights/ask { question }
//
// Two AI calls: the first turns the question into one SELECT over a small,
// euro-denominated copy of the ledger; the second phrases the answer from
// the result rows. The SQL runs against an in-memory database holding only
// ledger tables — never settings, credentials or bank data — so whatever the
// model writes can't read secrets or change anything real.
// ---------------------------------------------------------------------------

const ASK_SCHEMA = `transactions(id INTEGER, date TEXT 'YYYY-MM-DD', type TEXT 'earning'|'spending', amount REAL euros (always positive), description TEXT, category TEXT, recurring INTEGER 1 if created by a recurring template)
categories(name TEXT, type TEXT 'earning'|'spending'|'both')
budgets(category TEXT, month TEXT 'YYYY-MM' or NULL for the default monthly budget, amount REAL euros) -- a month row overrides the default for that month
recurring(description TEXT, type TEXT, amount REAL euros, frequency TEXT 'daily'|'weekly'|'monthly'|'yearly', category TEXT, active INTEGER, next_due TEXT)`;

const MAX_RESULT_ROWS = 200;
const ROWS_FOR_ANSWER = 60;

function buildLedgerCopy() {
  const mem = new Database(':memory:');
  mem.exec(`
    CREATE TABLE transactions (id INTEGER, date TEXT, type TEXT, amount REAL, description TEXT, category TEXT, recurring INTEGER);
    CREATE TABLE categories (name TEXT, type TEXT);
    CREATE TABLE budgets (category TEXT, month TEXT, amount REAL);
    CREATE TABLE recurring (description TEXT, type TEXT, amount REAL, frequency TEXT, category TEXT, active INTEGER, next_due TEXT);
  `);
  const copy = (sql, insertSql) => {
    const insert = mem.prepare(insertSql);
    mem.transaction((rows) => rows.forEach((r) => insert.run(r)))(db.prepare(sql).raw().all());
  };
  copy(
    `SELECT t.id, t.date, t.type, t.amount / 100.0, t.description, c.name, t.recurring_id IS NOT NULL
     FROM transactions t JOIN categories c ON c.id = t.category_id`,
    'INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  copy('SELECT name, type FROM categories', 'INSERT INTO categories VALUES (?, ?)');
  copy(
    'SELECT c.name, b.month, b.amount / 100.0 FROM budgets b JOIN categories c ON c.id = b.category_id',
    'INSERT INTO budgets VALUES (?, ?, ?)'
  );
  copy(
    `SELECT r.description, r.type, r.amount / 100.0, r.frequency, c.name, r.active, r.next_due
     FROM recurring_transactions r LEFT JOIN categories c ON c.id = r.category_id`,
    'INSERT INTO recurring VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  return mem;
}

function sqlPrompt(categoryNames) {
  return `You answer questions about the user's personal finance ledger (EUR) by writing ONE SQLite SELECT query.
Today is ${todayLocalDate()}. Tables:
${ASK_SCHEMA}
Category names: ${categoryNames.join(', ')}.
Notes: there are no account balances — "balance" means earnings minus spendings over a period. Descriptions are raw bank text; match them with LIKE '%...%' case-insensitively. Return at most ${MAX_RESULT_ROWS} rows, with readable column aliases and amounts rounded to 2 decimals.
Respond ONLY with a JSON object, no other text: {"sql": "SELECT ..."}
If the question can't be answered from these tables, respond {"error": "short reason"}.`;
}

const ANSWER_PROMPT = `You answer a question about the user's personal finances (EUR) from the result of a SQL query that was run for it.
Be direct and concise: lead with the answer (numbers formatted like €1,234.56), add at most two short sentences of useful context. Don't mention SQL or tables. If the result is empty, say nothing matched.
Respond ONLY with a JSON object, no other text: {"answer": "string"}`;

// Only a single read-only statement; recursive CTEs are refused because a
// runaway one would block the event loop (better-sqlite3 is synchronous).
function runQuery(mem, sql) {
  const trimmed = String(sql || '').trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(trimmed)) throw new Error('only SELECT queries are allowed');
  if (/\brecursive\b/i.test(trimmed)) throw new Error('recursive queries are not allowed');
  const stmt = mem.prepare(trimmed); // throws on multiple statements
  if (!stmt.reader) throw new Error('query returns no rows');
  const rows = [];
  for (const row of stmt.iterate()) {
    rows.push(row);
    if (rows.length >= MAX_RESULT_ROWS) break;
  }
  return { sql: trimmed, rows, columns: stmt.columns().map((c) => c.name) };
}

router.post('/ask', async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) return res.status(400).json({ error: 'question is required' });
  if (question.length > 500) return res.status(400).json({ error: 'question is too long (max 500 characters)' });

  const ai = getAiConfig();
  if (!ai) return res.status(400).json({ error: 'No AI provider configured — set one up in Settings.' });

  const mem = buildLedgerCopy();
  try {
    const categoryNames = mem.prepare('SELECT name FROM categories').pluck().all();
    let userContent = question;
    let result = null;
    // One retry: feed the SQLite error back so the model can fix its query.
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      const parsed = parseExtractionResponse(
        await callAiChat(ai, { systemPrompt: sqlPrompt(categoryNames), userContent })
      );
      if (parsed?.error) return res.json({ answer: String(parsed.error), sql: null, rows: [], columns: [] });
      try {
        result = runQuery(mem, parsed?.sql);
      } catch (err) {
        if (attempt === 1) throw new Error(`The generated query failed: ${err.message}`);
        userContent = `${question}\n\nYour previous query:\n${parsed?.sql}\nfailed with: ${err.message}\nWrite a corrected query.`;
      }
    }

    const parsed = parseExtractionResponse(
      await callAiChat(ai, {
        systemPrompt: ANSWER_PROMPT,
        userContent: JSON.stringify({
          question,
          rows: result.rows.slice(0, ROWS_FOR_ANSWER),
          totalRows: result.rows.length,
        }),
      })
    );
    res.json({
      answer: typeof parsed?.answer === 'string' ? parsed.answer : 'No answer returned.',
      ...result,
    });
  } catch (err) {
    console.error('[insights] ask failed:', err.message);
    res.status(502).json({ error: `${ai.label}: ${err.message}` });
  } finally {
    mem.close();
  }
});

export default router;
