// Builds a self-contained HTML document from a project's files, for the preview
// iframe. The iframe is sandboxed without allow-same-origin, so it has an opaque
// origin and can't load blob URLs from this page. Everything is inlined instead.

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// Resolves a reference inside a project file to a project path. Returns null for
// anything that isn't a project file: other sites, data: URLs, or going above the root.
export function resolveProjectPath(fromPath, reference) {
  const trimmed = (reference ?? "").trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//") || HAS_SCHEME.test(trimmed)) return null;
  let clean = trimmed.split(/[?#]/)[0];
  try {
    clean = decodeURI(clean);
  } catch {
    // Not valid percent-encoding, so take it literally
  }
  if (!clean) return null;
  const parts = clean.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);
  for (const segment of clean.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.length > 0 ? parts.join("/") : null;
}

export function isHtmlFile(path) {
  return /\.html?$/i.test(path);
}

export function defaultEntry(paths) {
  const html = paths.filter(isHtmlFile);
  if (html.length === 0) return null;
  const rootIndex = html.find((path) => /^index\.html?$/i.test(path));
  if (rootIndex) return rootIndex;
  const anyIndex = html.filter((path) => /(^|\/)index\.html?$/i.test(path)).sort((a, b) => a.length - b.length)[0];
  return anyIndex ?? [...html].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

// Text inside these tags can't be allowed to close them early
function escapeForScript(code) {
  return code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

function escapeForStyle(css) {
  return css.replace(/<\/(style)/gi, "<\\/$1");
}

function svgDataUri(text) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
}

async function inlineCss(css, cssPath, read, warnings, seen = new Set([cssPath])) {
  let result = css;
  const imports = [...result.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?[^;]*;/gi)];
  for (const [statement, reference] of imports) {
    const target = resolveProjectPath(cssPath, reference);
    if (!target) continue;
    if (seen.has(target)) {
      result = result.replace(statement, "");
      continue;
    }
    const imported = await read(target);
    if (imported === null) {
      warnings.push(`Can't find ${target}, imported by ${cssPath}.`);
      result = result.replace(statement, "");
    } else {
      seen.add(target);
      const nested = await inlineCss(imported, target, read, warnings, seen);
      result = result.replace(statement, () => nested);
    }
  }
  const urls = [...new Set([...result.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((match) => match[1]))];
  for (const reference of urls) {
    const target = resolveProjectPath(cssPath, reference);
    if (!target) continue;
    const content = /\.svg$/i.test(target) ? await read(target) : null;
    if (content !== null) {
      result = result.replace(new RegExp(`url\\(\\s*["']?${reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\s*\\)`, "g"), () => `url("${svgDataUri(content)}")`);
    } else {
      warnings.push(`${reference} in ${cssPath} can't be shown. The preview only has the project's text files.`);
    }
  }
  return result;
}

// Runs first inside the iframe. Reports the console and errors to the parent page,
// and turns the things the sandbox silently blocks into messages people can see.
function bootstrapSource(token) {
  return `(function () {
  var token = ${JSON.stringify(token)};
  var MAX_ARGUMENT = 10000;
  function send(kind, level, text) {
    try { parent.postMessage({ nexusPreview: token, kind: kind, level: level, text: text }, "*"); } catch (e) {}
  }
  function show(value, depth) {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack || String(value);
    if (typeof value === "function") return "[function " + (value.name || "anonymous") + "]";
    if (typeof Node !== "undefined" && value instanceof Node) return "<" + (value.nodeName || "node").toLowerCase() + ">";
    if (typeof value !== "object" || value === null) return String(value);
    try {
      var seen = [];
      return JSON.stringify(value, function (key, item) {
        if (typeof item === "object" && item !== null) {
          if (seen.indexOf(item) !== -1) return "[circular]";
          seen.push(item);
        }
        return typeof item === "function" ? "[function]" : item;
      });
    } catch (e) { return String(value); }
  }
  function format(args) {
    return Array.prototype.map.call(args, function (arg) {
      var text = show(arg);
      return text.length > MAX_ARGUMENT ? text.slice(0, MAX_ARGUMENT) + "..." : text;
    }).join(" ");
  }
  ["log", "info", "debug", "warn", "error"].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      send("console", level, format(arguments));
      if (original) original.apply(console, arguments);
    };
  });
  window.addEventListener("error", function (event) {
    if (event.target && event.target !== window && event.target.nodeName) {
      var url = event.target.src || event.target.href || "";
      send("console", "warn", "Couldn't load " + event.target.nodeName.toLowerCase() + (url ? ": " + url : ""));
      return;
    }
    send("console", "error", event.message || "Script error");
  }, true);
  window.addEventListener("unhandledrejection", function (event) {
    send("console", "error", "Unhandled promise rejection: " + show(event.reason));
  });
  window.alert = function (message) { send("console", "info", "alert: " + show(message)); };
  window.confirm = function (message) { send("console", "info", "confirm (answered Cancel): " + show(message)); return false; };
  window.prompt = function (message) { send("console", "info", "prompt (answered nothing): " + show(message)); return null; };
  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link) return;
    var href = link.getAttribute("href");
    if (href.charAt(0) === "#") return;
    event.preventDefault();
    send("navigate", "info", href);
  }, true);
  document.addEventListener("submit", function (event) {
    event.preventDefault();
    send("console", "info", "Forms don't submit in the preview.");
  }, true);
})();`;
}

// Allows inline code and resources from https sites, such as a CDN stylesheet. The
// sandbox provides the real isolation: this frame has no access to the app or its data.
const CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https:; style-src 'unsafe-inline' https:; " +
  "img-src https: data:; font-src https: data:; media-src https: data:; connect-src https:; form-action 'none'; base-uri 'none'";

/**
 * read(path) resolves to the file's text, or null if there's no such file.
 * Returns { html, warnings }, with warnings to show in the console pane.
 */
export async function buildPreviewDocument({ entryPath, read, token }) {
  const source = await read(entryPath);
  if (source === null) throw new Error(`Can't find ${entryPath}.`);
  const warnings = [];
  const doc = new DOMParser().parseFromString(source, "text/html");

  for (const base of doc.querySelectorAll("base")) base.remove();

  for (const link of doc.querySelectorAll('link[rel~="stylesheet" i][href]')) {
    const target = resolveProjectPath(entryPath, link.getAttribute("href"));
    if (!target) continue;
    const css = await read(target);
    if (css === null) {
      warnings.push(`Can't find ${target}, linked from ${entryPath}.`);
      link.remove();
      continue;
    }
    const style = doc.createElement("style");
    style.setAttribute("data-from", target);
    if (link.hasAttribute("media")) style.setAttribute("media", link.getAttribute("media"));
    style.textContent = escapeForStyle(await inlineCss(css, target, read, warnings));
    link.replaceWith(style);
  }

  for (const style of doc.querySelectorAll("style:not([data-from])")) {
    style.textContent = escapeForStyle(await inlineCss(style.textContent, entryPath, read, warnings));
  }

  // defer scripts run once the page has parsed, so inlined ones go at the end to match
  const deferred = [];
  for (const script of doc.querySelectorAll("script[src]")) {
    const target = resolveProjectPath(entryPath, script.getAttribute("src"));
    if (!target) continue;
    const code = await read(target);
    if (code === null) {
      warnings.push(`Can't find ${target}, loaded by ${entryPath}.`);
      script.remove();
      continue;
    }
    if (/^\s*(import\s[^;]*?from\s*)?["']\.{0,2}\//m.test(code) || /\bimport\s*\(\s*["']\.{0,2}\//.test(code)) {
      warnings.push(`${target} imports other project files, which the preview doesn't support. Use <script src="..."> tags instead.`);
    }
    const isDeferred = script.hasAttribute("defer") && script.getAttribute("type") !== "module";
    for (const attribute of ["src", "integrity", "crossorigin", "defer", "async"]) script.removeAttribute(attribute);
    script.setAttribute("data-from", target);
    script.textContent = escapeForScript(code);
    if (isDeferred) deferred.push(script);
  }
  for (const script of deferred) {
    script.remove();
    doc.body.appendChild(script);
  }

  for (const image of doc.querySelectorAll("img[src]")) {
    const target = resolveProjectPath(entryPath, image.getAttribute("src"));
    if (!target) continue;
    const content = /\.svg$/i.test(target) ? await read(target) : null;
    if (content !== null) image.setAttribute("src", svgDataUri(content));
    else warnings.push(`${target} can't be shown. The preview only has the project's text files.`);
  }

  const bootstrap = doc.createElement("script");
  bootstrap.textContent = bootstrapSource(token);
  const policy = doc.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", CSP);
  doc.head.prepend(policy, bootstrap);

  return { html: `<!doctype html>\n${doc.documentElement.outerHTML}`, warnings };
}
