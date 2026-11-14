// The single motion switch. CSS reads it through tokens.css (data-motion and the
// prefers-reduced-motion query); JavaScript-driven animation asks motionAllowed().
const STORAGE_KEY = "motion";

// "reduce" | "full" | null (null: follow the operating system)
export function storedMotion() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "reduce" || value === "full" ? value : null;
  } catch {
    return null;
  }
}

export function applyMotion(value = storedMotion()) {
  const root = document.documentElement;
  if (value) root.dataset.motion = value;
  else delete root.dataset.motion;
}

export function setMotionPreference(value) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the choice lasts for this page only
  }
  applyMotion(value);
}

function systemPrefersReduced() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export function motionAllowed() {
  if (typeof document === "undefined") return false;
  const choice = document.documentElement.dataset.motion;
  if (choice === "reduce") return false;
  if (choice === "full") return true;
  return !systemPrefersReduced();
}

// Reads a duration token ("200ms") as a number of milliseconds
export function durationMs(token = "--duration-base", fallback = 200) {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const value = parseFloat(raw);
  return Number.isFinite(value) ? (raw.endsWith("s") && !raw.endsWith("ms") ? value * 1000 : value) : fallback;
}

// Runs `update` inside a View Transition when the browser has them and motion is
// allowed; otherwise just runs it. Returns nothing either way.
export function withViewTransition(update) {
  if (typeof document !== "undefined" && document.startViewTransition && motionAllowed()) {
    document.startViewTransition(update);
  } else {
    update();
  }
}
