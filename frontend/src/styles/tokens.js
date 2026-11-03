// Reads a design token (CSS variable from styles/theme.css) for places that
// need a literal colour, like chart SVG attributes, which can't use var().
export function cssVar(name, fallback = "") {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
