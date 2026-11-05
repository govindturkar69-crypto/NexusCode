// Theme choice, with no React in it. A user's choice is kept per username, so
// people sharing a browser don't overwrite each other's. With no choice stored
// the theme follows the operating system.
import { tokenSubject } from "../api/client";

const THEMES = ["light", "dark"];

function storageKey(username) {
  return username ? `theme:${username}` : "theme";
}

export function storedTheme(username) {
  const value = localStorage.getItem(storageKey(username));
  return THEMES.includes(value) ? value : null;
}

export function storeTheme(username, theme) {
  localStorage.setItem(storageKey(username), theme);
}

const lightQuery = () => window.matchMedia?.("(prefers-color-scheme: light)");

export function systemTheme() {
  return lightQuery()?.matches ? "light" : "dark";
}

// Calls back when the operating system's preference changes; returns the unsubscribe
export function watchSystemTheme(callback) {
  const query = lightQuery();
  if (!query) return () => {};
  const listener = () => callback(systemTheme());
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

// theme.css keys its colour tokens off this attribute
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

// Before the first render, so a page never paints in the wrong colours
export function applyInitialTheme() {
  applyTheme(storedTheme(tokenSubject()) ?? systemTheme());
}
