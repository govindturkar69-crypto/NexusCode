// A stable colour per person, shared by live-editing cursors and avatars.
// No imports on purpose: the app shell uses it, and anything imported here
// would land in the main bundle (collabSession pulls in Yjs, ~86 kB).
const COLORS = ["#e5534b", "#d97706", "#16a34a", "#0891b2", "#2563eb", "#7c3aed", "#db2777", "#65a30d", "#ea580c", "#0d9488"];

export function colorFor(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}
