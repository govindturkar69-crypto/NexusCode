import { useEffect, useRef, useState } from "react";
import { MAX_OUTPUT_CHARS, RUN_TIMEOUT_MS } from "../runners/runController";
import { runJavaScript } from "../runners/runJavaScript";
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
  const current = useRef(null);

  // Leaving the page or switching file ends the run
  useEffect(() => () => current.current?.stop(), []);

  function run() {
    setRunning(true);
    setOutcome(null);
    setOutput([]);
    const fileName = file.path.slice(file.path.lastIndexOf("/") + 1);
    const handle = runJavaScript({ code, fileName, onOutput: setOutput });
    current.current = handle;
    handle.result.then(({ status, output: finalOutput, durationMs }) => {
      if (current.current !== handle) return;
      current.current = null;
      setOutput(finalOutput);
      setOutcome({ status, durationMs });
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
          {running && <span role="status" className="small muted">Running...</span>}
          {status && (
            <span role="status" className={`small ${status.tone}`}>
              {status.text} · {formatDuration(outcome.durationMs)}
            </span>
          )}
        </div>
        {allText && !running && <CopyButton text={allText} label="Copy output" />}
      </div>
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
