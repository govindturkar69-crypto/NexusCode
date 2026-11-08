import { MAX_OUTPUT_CHARS, RUN_TIMEOUT_MS } from "../runners/runController";
import { CopyButton } from "./AIMarkdown";
import Button from "./ui/Button";

const STATUS_TEXT = {
  ok: { text: "Finished", tone: "text-success" },
  error: { text: "Failed", tone: "text-danger" },
  timeout: { text: `Stopped: it ran longer than the ${RUN_TIMEOUT_MS / 1000} second limit`, tone: "text-danger" },
  "output-limit": { text: `Stopped: it printed more than the ${MAX_OUTPUT_CHARS / 1000} KB limit`, tone: "text-danger" },
  stopped: { text: "Stopped", tone: "muted" },
  crashed: { text: "The code runner failed", tone: "text-danger" },
};

function formatDuration(ms) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

// Below the editor: Python's first-load progress, then what the program printed
function RunPanel({ result, running, loading, onClear }) {
  const { output, outcome } = result;
  if (!running && !outcome && output.length === 0) return null;
  const status = outcome ? STATUS_TEXT[outcome.status] : null;
  const allText = output.map((chunk) => chunk.text).join("");

  return (
    <section className="run-panel" aria-label="Run output">
      <div className="row row--between">
        <div role="status" className="small">
          {running && !loading && <span className="muted">Running...</span>}
          {running && loading?.stage === "starting" && <span className="muted">Starting Python...</span>}
          {running && loading?.stage === "download" && (
            <label htmlFor="python-download" className="muted">
              Downloading Python, only needed once: {(loading.received / 1_000_000).toFixed(1)} of {(loading.total / 1_000_000).toFixed(1)} MB
            </label>
          )}
          {status && <span className={status.tone}>{status.text} · {formatDuration(outcome.durationMs)}</span>}
        </div>
        {!running && (
          <div className="row" style={{ "--gap": "0.25rem" }}>
            {allText && <CopyButton text={allText} label="Copy" />}
            <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
          </div>
        )}
      </div>
      {running && loading?.stage === "download" && (
        <progress id="python-download" className="run-progress" value={loading.received} max={loading.total} />
      )}
      {output.length > 0 && (
        <pre className="run-output" aria-label="Program output">
          {output.map((chunk, index) => (
            <span key={index} className={chunk.stream === "stderr" ? "text-danger" : undefined}>{chunk.text}</span>
          ))}
        </pre>
      )}
      {outcome?.status === "ok" && output.length === 0 && <p className="muted small" style={{ marginTop: "0.5rem" }}>No output.</p>}
    </section>
  );
}

export default RunPanel;
