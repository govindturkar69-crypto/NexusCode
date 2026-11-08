import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildPreviewDocument, defaultEntry, isHtmlFile, resolveProjectPath } from "../editor/preview";
import Button from "./ui/Button";

const MAX_CONSOLE_LINES = 500;
const MAX_CONSOLE_CHARS = 100_000;
// A page logging in a loop shouldn't repaint the editor for every line
const CONSOLE_FLUSH_MS = 50;

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function capLines(lines) {
  const kept = lines.slice(-MAX_CONSOLE_LINES);
  let total = kept.reduce((sum, line) => sum + line.text.length, 0);
  while (total > MAX_CONSOLE_CHARS && kept.length > 1) total -= kept.shift().text.length;
  return kept;
}

/**
 * Renders a project's HTML in an iframe with sandbox="allow-scripts" only. With no
 * allow-same-origin it has an opaque origin: no access to this page, its storage
 * or the login token, and no top navigation, popups or forms.
 *
 * readFile(file) resolves to the file's text. refreshKey changes on every save.
 */
function PreviewPanel({ files, readFile, refreshKey, preferredEntry, onClose }) {
  const htmlPaths = useMemo(() => files.map((file) => file.path).filter(isHtmlFile), [files]);
  const [chosen, setChosen] = useState(null);
  const [srcDoc, setSrcDoc] = useState(null);
  const [reloads, setReloads] = useState(0);
  const [lines, setLines] = useState([]);
  const [error, setError] = useState("");
  const frame = useRef(null);
  const token = useRef(null);
  if (token.current === null) token.current = randomToken();
  const queued = useRef([]);
  const flushTimer = useRef(null);

  const addLine = useCallback((line) => {
    // Never let the queue outgrow the console while waiting for the next flush
    if (queued.current.length >= MAX_CONSOLE_LINES) queued.current.shift();
    queued.current.push(line);
    if (flushTimer.current !== null) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      const batch = queued.current;
      queued.current = [];
      setLines((previous) => capLines([...previous, ...batch]));
    }, CONSOLE_FLUSH_MS);
  }, []);

  const clearLines = useCallback(() => {
    queued.current = [];
    setLines([]);
  }, []);

  useEffect(() => () => clearTimeout(flushTimer.current), []);

  const entry = chosen && htmlPaths.includes(chosen)
    ? chosen
    : (preferredEntry && htmlPaths.includes(preferredEntry) ? preferredEntry : defaultEntry(htmlPaths));

  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  const readFileRef = useRef(readFile);
  useEffect(() => {
    readFileRef.current = readFile;
  }, [readFile]);

  useEffect(() => {
    if (!entry) return undefined;
    let cancelled = false;
    const read = async (path) => {
      const file = filesRef.current.find((candidate) => candidate.path === path);
      return file ? readFileRef.current(file) : null;
    };
    buildPreviewDocument({ entryPath: entry, read, token: token.current })
      .then(({ html, warnings }) => {
        if (cancelled) return;
        setError("");
        setSrcDoc((previous) => {
          if (previous === html) return previous;
          // A new document is a fresh page, so its console starts empty
          queued.current = [];
          setLines(warnings.map((text) => ({ level: "warn", text })));
          return html;
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [entry, refreshKey]);

  useEffect(() => {
    function onMessage(event) {
      // Only this frame, and it can only add text to the console or switch between project pages
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data;
      if (!data || data.nexusPreview !== token.current || typeof data.text !== "string") return;
      if (data.kind === "console") {
        const level = ["warn", "error"].includes(data.level) ? data.level : "log";
        addLine({ level, text: data.text });
      } else if (data.kind === "navigate") {
        const target = resolveProjectPath(entry, data.text);
        if (target && htmlPaths.includes(target)) setChosen(target);
        else addLine({ level: "log", text: `This link doesn't open in the preview: ${data.text}` });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [entry, htmlPaths, addLine]);

  function reload() {
    clearLines();
    setReloads((count) => count + 1);
  }

  return (
    <section className="preview-panel" aria-label="Preview">
      <div className="preview-panel__bar">
        <label className="small" htmlFor="preview-entry">Page</label>
        <select id="preview-entry" className="input input--sm" value={entry ?? ""} onChange={(e) => setChosen(e.target.value)}>
          {htmlPaths.map((path) => <option key={path} value={path}>{path}</option>)}
        </select>
        <Button size="sm" variant="ghost" onClick={reload}>↻ Reload</Button>
        {onClose && <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}
      </div>
      {error && <p role="alert" className="small text-danger" style={{ padding: "0.5rem" }}>{error}</p>}
      {!entry && <p className="muted small" style={{ padding: "0.5rem" }}>Add an .html file to preview it.</p>}
      {entry && srcDoc !== null && (
        <iframe
          key={reloads}
          ref={frame}
          title="Project preview"
          className="preview-panel__frame"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
        />
      )}
      <div className="preview-console">
        <div className="preview-console__bar">
          <span className="small muted">Console</span>
          <Button size="sm" variant="ghost" onClick={clearLines} disabled={lines.length === 0}>Clear</Button>
        </div>
        <div role="log" aria-label="Preview console" className="preview-console__lines">
          {lines.length === 0 && <p className="hint" style={{ margin: 0 }}>console.log output and errors appear here.</p>}
          {lines.map((line, index) => (
            <pre key={index} className={`preview-console__line preview-console__line--${line.level}`}>{line.text}</pre>
          ))}
        </div>
      </div>
    </section>
  );
}

export default PreviewPanel;
