// Every keyboard shortcut, in one place: the "?" overlay lists these, tooltips
// show their hints, and the handlers match keys with matches() below.
//
// None of them clash with Monaco: single keys and "g then x" only work outside
// text fields and the editor; the editor's own are Alt+key or Ctrl/Cmd+Enter,
// which Monaco leaves free.

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// keys: what to press, in order; "Mod" is Ctrl (or Cmd on a Mac).
// A "then" between keys means press one after the other.
export const SHORTCUTS = [
  { id: "palette", group: "Anywhere", keys: ["Mod", "K"], label: "Open the command palette" },
  { id: "help", group: "Anywhere", keys: ["?"], label: "Show keyboard shortcuts" },
  { id: "theme", group: "Anywhere", keys: ["Shift", "T"], label: "Switch light and dark theme" },
  { id: "go-projects", group: "Go to", keys: ["G", "then", "P"], label: "Projects" },
  { id: "go-dashboard", group: "Go to", keys: ["G", "then", "D"], label: "Dashboard" },
  { id: "go-ai", group: "Go to", keys: ["G", "then", "A"], label: "AI Assistant" },
  { id: "go-settings", group: "Go to", keys: ["G", "then", "S"], label: "Settings" },
  { id: "go-board", group: "Go to", keys: ["G", "then", "B"], label: "Board (in a project)" },
  { id: "go-editor", group: "Go to", keys: ["G", "then", "E"], label: "Code editor (in a project)" },
  { id: "go-meeting", group: "Go to", keys: ["G", "then", "M"], label: "Video meeting (in a project)" },
  { id: "new-task", group: "Board", keys: ["N"], label: "New task" },
  { id: "filter", group: "Board", keys: ["/"], label: "Filter tasks" },
  { id: "move-task", group: "Board", keys: ["Space", "then", "←↑↓→"], label: "Pick up a task by its handle and move it" },
  { id: "run", group: "Code editor", keys: ["Mod", "Enter"], label: "Run the open file" },
  { id: "new-file", group: "Code editor", keys: ["Alt", "N"], label: "New file" },
  { id: "panel-files", group: "Code editor", keys: ["Alt", "1"], label: "Focus the file tree" },
  { id: "panel-editor", group: "Code editor", keys: ["Alt", "2"], label: "Focus the editor" },
  { id: "panel-side", group: "Code editor", keys: ["Alt", "3"], label: "Focus the output or agent panel" },
  { id: "close-dialog", group: "Dialogs", keys: ["Esc"], label: "Close a dialog, menu or drawer" },
];

export const GROUPS = ["Anywhere", "Go to", "Board", "Code editor", "Dialogs"];

export function keyLabel(key) {
  if (key === "Mod") return isMac ? "⌘" : "Ctrl";
  if (key === "Alt") return isMac ? "⌥" : "Alt";
  if (key === "Shift") return isMac ? "⇧" : "Shift";
  return key;
}

// "Ctrl K", "G then P": for tooltips and menus
export function hint(id) {
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  return shortcut ? shortcut.keys.map(keyLabel).join(" ") : "";
}

// For aria-keyshortcuts: "Control+K", "Alt+N"
export function ariaKeys(id) {
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  if (!shortcut || shortcut.keys.includes("then")) return undefined;
  return shortcut.keys.map((k) => (k === "Mod" ? (isMac ? "Meta" : "Control") : k)).join("+");
}

// Typing in a field, or in the code editor: single-key shortcuts stay out of the way
export function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest(".monaco-editor, [contenteditable=''], [contenteditable='true']")) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(target.type);
  return false;
}

// A single key with no Ctrl/Cmd/Alt (Shift allowed only when asked for)
export function plainKey(event, key, { shift = false } = {}) {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (shift !== event.shiftKey && key.length === 1 && /[a-z]/i.test(key)) return false;
  return event.key.toLowerCase() === key.toLowerCase();
}

// Alt+<key>, using event.code so Mac's Option characters (Alt+N = "˜") still match
export function altKey(event, key) {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const code = /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`;
  return event.code === code;
}

// "g then x" navigation: returns a keydown handler that calls go(letter)
// when "g" is followed by another letter within a second
export function sequenceHandler(go, timeoutMs = 1000) {
  let pendingSince = null;
  return (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || isTypingTarget(event.target)) return false;
    const key = event.key.toLowerCase();
    const now = Date.now();
    if (pendingSince !== null && now - pendingSince <= timeoutMs && /^[a-z]$/.test(key)) {
      pendingSince = null;
      return go(key) !== false;
    }
    pendingSince = key === "g" ? now : null;
    return false;
  };
}
