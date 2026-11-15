// Monaco themes that sit on the app's own surfaces. Monaco can't read CSS
// variables, so these mirror the colour tokens in styles/tokens.css.
const PALETTES = {
  // comment: AA (4.5:1) on the background and on the diff tints below
  dark: { base: "vs-dark", bg: "#0d1117", surface: "#151b23", raised: "#1c2330", border: "#2a313c", text: "#e6edf3", subtle: "#8b95a2", accent: "#58a6ff", comment: "8b949e" },
  light: { base: "vs", bg: "#ffffff", surface: "#f6f8fa", raised: "#eef1f4", border: "#d8dee4", text: "#1f2328", subtle: "#636c76", accent: "#0969da", comment: "57606a" },
};

let defined = false;

// Pass as `beforeMount` to <Editor> / <DiffEditor>; defining twice is harmless
export function defineNexusThemes(monaco) {
  if (defined) return;
  for (const [name, p] of Object.entries(PALETTES)) {
    monaco.editor.defineTheme(`nexus-${name}`, {
      base: p.base,
      inherit: true,
      rules: [{ token: "comment", foreground: p.comment }],
      colors: {
        "editor.background": p.bg,
        "editor.foreground": p.text,
        "editorGutter.background": p.bg,
        "editor.lineHighlightBackground": p.surface,
        "editor.lineHighlightBorder": p.surface,
        "editorLineNumber.foreground": p.subtle,
        "editorLineNumber.activeForeground": p.text,
        "editorCursor.foreground": p.accent,
        "editor.selectionBackground": `${p.accent}40`,
        "editor.inactiveSelectionBackground": `${p.accent}26`,
        "editorIndentGuide.background1": p.border,
        "editorWidget.background": p.surface,
        "editorWidget.border": p.border,
        "editorSuggestWidget.background": p.surface,
        "editorSuggestWidget.border": p.border,
        "editorHoverWidget.background": p.surface,
        "editorHoverWidget.border": p.border,
        "scrollbarSlider.background": `${p.subtle}33`,
        "scrollbarSlider.hoverBackground": `${p.subtle}55`,
        // Light tints, so code on changed lines keeps AA contrast
        "diffEditor.insertedTextBackground": "#2ea0431a",
        "diffEditor.removedTextBackground": "#f851491a",
        "diffEditor.insertedLineBackground": "#2ea04314",
        "diffEditor.removedLineBackground": "#f8514914",
      },
    });
  }
  defined = true;
}

export function monacoTheme(theme) {
  return theme === "light" ? "nexus-light" : "nexus-dark";
}
