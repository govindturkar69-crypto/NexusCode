import { useEffect, useRef, useState } from "react";
import { MAX_OUTPUT_CHARS, RUN_TIMEOUT_MS } from "../runners/runController";
import { runJavaScript } from "../runners/runJavaScript";
import { runPython } from "../runners/runPython";
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

// Runs in this browser, with what's in the editor. Unsaved changes are included,
// and nothing is sent anywhere, so viewers can run code too.
function RunPanel({ file, code }) {
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState([]);
  const [outcome, setOutcome] = useState(null);
  const [loading, setLoading] = useState(null); // { stage, received, total } while Python loads
  const [stdin, setStdin] = useState("");
  const current = useRef(null);
  const isPython = /\.py$/i.test(file.path);

  // Leaving the page or switching file ends the run
  useEffect(() => () => current.current?.stop(), []);

  function run() {
    setRunning(true);
    setOutcome(null);
    setOutput([]);
    setLoading(null);
    const fileName = file.path.slice(file.path.lastIndexOf("/") + 1);
    const handle = isPython
      ? runPython({
          code,
          fileName,
          stdin,
          onOutput: (chunks) => {
            setLoading(null);
            setOutput(chunks);
          },
          onProgress: setLoading,
        })
      : runJavaScript({ code, fileName, onOutput: setOutput });
    current.current = handle;
    handle.result.then(({ status, output: finalOutput, durationMs }) => {
      if (current.current !== handle) return;
      current.current = null;
      setOutput(finalOutput);
      setOutcome({ status, durationMs });
      setLoading(null);
      setRunning(false);
    });
  }

  const allText = output.map((chunk) => chunk.text).join("");
  const status = outcome ? STATUS_TEXT[outcome.status] : null;

  return (
    <section className="run-panel" aria-label="Run">
      <div className="row row--between">
        <div className="row" style={{ "--gap": "0.5rem" }}>
          {running ? (
            <Button size="sm" variant="danger" onClick={() => current.current?.stop()}>■ Stop</Button>
          ) : (
            <Button size="sm" onClick={run}>▶ Run</Button>
          )}
          {running && !loading && <span role="status" className="small muted">Running...</span>}
          {status && (
            <span role="status" className={`small ${status.tone}`}>
              {status.text} · {formatDuration(outcome.durationMs)}
            </span>
          )}
        </div>
        {allText && !running && <CopyButton text={allText} label="Copy output" />}
      </div>
      {loading && (
        <div role="status" className="small muted" style={{ marginTop: "0.5rem" }}>
          {loading.stage === "download" ? (
            <>
              <label htmlFor="python-download">
                Downloading Python, only needed once: {(loading.received / 1_000_000).toFixed(1)} of {(loading.total / 1_000_000).toFixed(1)} MB
              </label>
              <progress id="python-download" className="run-progress" value={loading.received} max={loading.total} />
            </>
          ) : (
            "Starting Python..."
          )}
        </div>
      )}
      {isPython && (
        <details className="small" style={{ marginTop: "0.5rem" }}>
          <summary>Input (stdin){stdin ? ": set" : ""}</summary>
          <label htmlFor="run-stdin" className="visually-hidden">Input (stdin)</label>
          <textarea
            id="run-stdin"
            className="input mono small"
            rows={3}
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            placeholder="One line for each input() call"
          />
        </details>
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
