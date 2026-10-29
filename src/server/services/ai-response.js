// Shared helpers for turning an AI provider's reply (and bank/statement
// amounts) into the values a pending_transactions row needs. Pure functions,
// used by statement import, bank sync and pending categorization.

// ---------------------------------------------------------------------------
// Response parsing (defensive: strip code fences, tolerate surrounding text)
// ---------------------------------------------------------------------------

export function stripCodeFences(text) {
  if (typeof text !== 'string') return '';
  let t = text.trim();
  // ```json ... ``` or ``` ... ```
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  return t;
}

// Extracts the first balanced {...} JSON object from arbitrary text.
function firstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse the model's assistant content into an object. Tolerates code fences and
 * surrounding prose. Throws if no JSON object can be recovered.
 */
export function parseExtractionResponse(content) {
  const cleaned = stripCodeFences(content);
  try {
    return JSON.parse(cleaned);
  } catch {
    const candidate = firstJsonObject(cleaned);
    if (candidate) {
      return JSON.parse(candidate); // may still throw → caller treats as unparseable
    }
    throw new Error('No JSON object found in AI response');
  }
}

// ---------------------------------------------------------------------------
// Amounts, confidence, category resolution
// ---------------------------------------------------------------------------

export function toCents(amount) {
  const n = typeof amount === 'string' ? Number(amount.replace(/[^0-9.\-]/g, '')) : Number(amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Resolve a category-name suggestion to a category id, case-insensitively,
 * additionally requiring the category's type to be compatible with `type`
 * (a `both` category matches anything). Falls back to the "Other" system
 * category when there is no compatible match — this is what makes every
 * produced pending row approvable by construction (its category always
 * matches its type).
 */
export function resolveCategoryId(name, type, categories, otherId) {
  if (typeof name === 'string' && name.trim()) {
    const target = name.trim().toLowerCase();
    const match = categories.find((c) => c.name.toLowerCase() === target);
    if (match && (match.type === 'both' || match.type === type)) return match.id;
  }
  return otherId;
}

