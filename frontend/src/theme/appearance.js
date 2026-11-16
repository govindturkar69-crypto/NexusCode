// Accent colour and contrast, on top of the light/dark theme. Both are kept on
// this device (like the motion setting) and applied as data-accent /
// data-contrast on <html>; styles/accents.css holds the matching tokens, and
// index.html applies them before the first paint, so nothing flashes.
//
// Every combination meets WCAG AA (checked in theme/appearance.test.js):
// accent text 4.5:1 on every surface and on the accent tint, text on a filled
// accent button 4.5:1, and the accent itself (focus rings, borders) 3:1.

// [accent, accent text (links, tinted labels), text on a filled accent]
export const ACCENTS = {
  blue: { label: "Blue", dark: ["#58a6ff", "#79b8ff", "#0b1220"], light: ["#0969da", "#0550ae", "#ffffff"] },
  violet: { label: "Violet", dark: ["#a371f7", "#bc8cff", "#0b1220"], light: ["#8250df", "#6639ba", "#ffffff"] },
  green: { label: "Green", dark: ["#3fb950", "#56d364", "#0b1220"], light: ["#1a7f37", "#116329", "#ffffff"] },
  orange: { label: "Orange", dark: ["#f0883e", "#ffa657", "#0b1220"], light: ["#bc4c00", "#953800", "#ffffff"] },
  pink: { label: "Pink", dark: ["#f778ba", "#ff9bce", "#0b1220"], light: ["#bf3989", "#99286e", "#ffffff"] },
};
export const DEFAULT_ACCENT = "blue";
export const CONTRASTS = ["normal", "high"];

const ACCENT_KEY = "accent";
const CONTRAST_KEY = "contrast";

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage blocked: the choice lasts for this page only
  }
}

export function storedAccent() {
  const value = read(ACCENT_KEY);
  return Object.hasOwn(ACCENTS, value ?? "") ? value : DEFAULT_ACCENT;
}

export function storedContrast() {
  return read(CONTRAST_KEY) === "high" ? "high" : "normal";
}

export function applyAccent(accent) {
  const root = document.documentElement;
  if (accent && accent !== DEFAULT_ACCENT) root.dataset.accent = accent;
  else delete root.dataset.accent;
}

export function applyContrast(contrast) {
  const root = document.documentElement;
  if (contrast === "high") root.dataset.contrast = "high";
  else delete root.dataset.contrast;
}

export function storeAccent(accent) {
  const value = Object.hasOwn(ACCENTS, accent) ? accent : DEFAULT_ACCENT;
  write(ACCENT_KEY, value === DEFAULT_ACCENT ? null : value);
  applyAccent(value);
  return value;
}

export function storeContrast(contrast) {
  const value = contrast === "high" ? "high" : "normal";
  write(CONTRAST_KEY, value === "high" ? "high" : null);
  applyContrast(value);
  return value;
}

export function applyInitialAppearance() {
  applyAccent(storedAccent());
  applyContrast(storedContrast());
}
