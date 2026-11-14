// Fuzzy matching for the command palette: the query's characters must appear in
// order (case-insensitive). Consecutive runs, word starts and an early first
// match score higher. Returns null for no match, else { score, indices }.

const isBoundary = (text, i) => i === 0 || /[\s/_\-.@:>]/.test(text[i - 1]) || (/[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i]));

export function fuzzyMatch(query, text) {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const lower = String(text).toLowerCase();
  // Plain substring: best case, scored by position
  const at = lower.indexOf(q);
  if (at !== -1) {
    return { score: 1000 - at + (isBoundary(text, at) ? 200 : 0) - text.length * 0.1, indices: Array.from({ length: q.length }, (_, k) => at + k) };
  }
  const indices = [];
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const i = lower.indexOf(ch, from);
    if (i === -1) return null;
    score += 10;
    if (i === previous + 1) score += 15;
    if (isBoundary(text, i)) score += 20;
    indices.push(i);
    previous = i;
    from = i + 1;
  }
  score -= indices[0] * 0.5 + text.length * 0.1;
  return { score, indices };
}

// Split text into [{ text, match }] runs for highlighting
export function highlight(text, indices) {
  const set = new Set(indices);
  const parts = [];
  for (let i = 0; i < text.length; i++) {
    const match = set.has(i);
    const last = parts[parts.length - 1];
    if (last && last.match === match) last.text += text[i];
    else parts.push({ text: text[i], match });
  }
  return parts;
}
