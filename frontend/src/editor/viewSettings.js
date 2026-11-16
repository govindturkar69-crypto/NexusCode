// The code editor's view settings (text size, word wrap, minimap), kept on this
// device. With storage blocked they last for the visit.
const KEY = "editor-view";
export const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20];
export const DEFAULT_VIEW = { fontSize: 14, wordWrap: false, minimap: false };

export function readView() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!value || typeof value !== "object") return DEFAULT_VIEW;
    return {
      fontSize: FONT_SIZES.includes(value.fontSize) ? value.fontSize : DEFAULT_VIEW.fontSize,
      wordWrap: value.wordWrap === true,
      minimap: value.minimap === true,
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function storeView(view) {
  try {
    localStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    // Blocked: this visit only
  }
  return view;
}

// One step up or down the size list, staying inside it
export function stepFontSize(size, direction) {
  const index = FONT_SIZES.indexOf(size);
  const next = (index === -1 ? FONT_SIZES.indexOf(DEFAULT_VIEW.fontSize) : index) + direction;
  return FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, next))];
}

// Monaco options for these settings
export function monacoViewOptions(view) {
  return { fontSize: view.fontSize, wordWrap: view.wordWrap ? "on" : "off", minimap: { enabled: view.minimap } };
}
