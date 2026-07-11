// Fixed-order categorical fallback palette for categories without a stored
// color. Order matters (CVD-safety), so a category is assigned a slot by its
// stable position in the list, never re-cycled per render.
// Validated against the app's dark card surface (#111827) — see dataviz skill.
export const FALLBACK_PALETTE = [
  '#3987e5', // blue
  '#199e70', // aqua
  '#c98500', // yellow
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
  '#d55181', // magenta
  '#d95926', // orange
];

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
