// Avatar helpers: readable initials on a person's colour.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// White or near-black initials, whichever contrasts more with the colour
export function textOn(hex) {
  const l = luminance(hex);
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (luminance("#0d1117") + 0.05);
  return onWhite >= onDark ? "#ffffff" : "#0d1117";
}

export function initials(name = "") {
  const words = String(name).replace(/[_\-.]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  // demo_priya -> "DP"; olivia -> "OL"
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
}
