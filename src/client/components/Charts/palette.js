// Categorical ramp for categories without a stored color. Ordered by weight —
// spending series read hottest first (brick → amber → limes → sand), matching
// the reference dashboard's donut. A category takes a slot by its stable id,
// never re-cycled per render.
// Validated against the app's panel surface over #080d0a.
export const FALLBACK_PALETTE = [
  '#bc4749', // brick
  '#d99a4e', // amber
  '#a7c957', // lime
  '#6a994e', // lime mid
  '#386641', // lime deep
  '#cbbf9a', // sand
  '#e88f8f', // brick light
  '#7d8c6a', // moss
];

// Shared series colors so every chart speaks the same language.
export const EARNING_COLOR = '#a7c957';
export const SPENDING_COLOR = '#bc4749';
export const SPENDING_LINE_COLOR = '#e88f8f';
export const AXIS_COLOR = 'rgba(242,232,207,.38)';
export const GRID_COLOR = 'rgba(242,232,207,.10)';

// Returns a stable color for a category: its own stored color if set,
// otherwise a fallback slot picked deterministically from its id so the same
// category always gets the same fallback color across renders/charts.
export function colorForCategory(category, indexFallback = 0) {
  if (category?.category_color) return category.category_color;
  if (category?.color) return category.color;
  const key = category?.category_id ?? category?.id ?? indexFallback;
  const idx = Math.abs(Number(key) || indexFallback) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[idx];
}
