// The palette's recently used items, per browser. Storage can be blocked (private
// windows, policies): then recents just aren't remembered.
const KEY = "nexus.palette.recent";
const MAX = 6;

export function loadRecents() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((item) => item && typeof item.key === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

// item: { key, label, hint, kind } (no secrets: labels the user already sees)
export function rememberRecent(item) {
  try {
    const next = [item, ...loadRecents().filter((r) => r.key !== item.key)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return loadRecents();
  }
}
