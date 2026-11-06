// Which runner a file gets, by extension. Everything runs in the browser.

const EXTENSIONS = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  html: "preview",
  htm: "preview",
};

function extensionOf(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// A stylesheet only makes sense on a page, so in a project with a page it previews that
export function runnerFor(path, { hasHtml = false } = {}) {
  const extension = extensionOf(path);
  if (extension === "css" && hasHtml) return "preview";
  return EXTENSIONS[extension] ?? null;
}

export const UNSUPPORTED_MESSAGE = "This file type can't run in the browser. Run works with Python (.py), JavaScript (.js) and web pages (.html).";
