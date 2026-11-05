import { useState } from "react";
import { apiFetch } from "../api/client";
import Button from "./ui/Button";

function Output({ label, text, danger }) {
  if (!text) return null;
  return (
    <div>
      <div className="muted small">{label}</div>
      <pre className={`run-output ${danger ? "text-danger" : ""}`}>{text}</pre>
    </div>
  );
}

// Runs one file. `info` is GET /run/info; beforeRun saves the file first,
// because the server runs what's saved.
function RunPanel({ file, info, beforeRun, onRemaining }) {
  const [stdin, setStdin] = useState("");
  const [showStdin, setShowStdin] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  if (!info) return null;
  const supported = info.languages.includes(file.language);

  function run() {
    setRunning(true);
    setError("");
    setResult(null);
    beforeRun()
      .then(() => apiFetch(`/code-files/${file.id}/run`, { method: "POST", body: { stdin } }))
      .then((data) => {
        setResult(data);
        onRemaining(data.remaining_today);
      })
      .catch((err) => setError(err.message))
      .finally(() => setRunning(false));
  }

  return (
    <div className="run-panel">
      <div className="row row--between">
        <div className="row" style={{ "--gap": "0.5rem" }}>
          <Button size="sm" onClick={run} disabled={running || !info.enabled || !supported || info.remaining_today === 0}>
            {running ? "Running..." : "▶ Run"}
          </Button>
          <Button size="sm" variant="ghost" aria-expanded={showStdin} onClick={() => setShowStdin(!showStdin)}>
            Input
          </Button>
        </div>
        <span className="hint" style={{ margin: 0 }}>
          {!info.enabled && "Running code isn't set up on this server yet."}
          {info.enabled && !supported && "This file type can't be run."}
          {info.enabled && supported && `${info.remaining_today} run${info.remaining_today === 1 ? "" : "s"} left today`}
        </span>
      </div>

      {showStdin && (
        <div className="field" style={{ marginTop: "0.5rem" }}>
          <label htmlFor="run-stdin" className="field__label">Program input (stdin)</label>
          <textarea id="run-stdin" className="input mono small" rows={3} maxLength={10000} value={stdin} onChange={(e) => setStdin(e.target.value)} />
        </div>
      )}

      {error && <p role="alert" className="small text-danger" style={{ marginTop: "0.5rem" }}>{error}</p>}

      <div aria-live="polite" className="stack" style={{ marginTop: result ? "0.5rem" : 0, "--gap": "0.5rem" }}>
        {result && (
          <>
            <p className={`small ${result.succeeded ? "text-success" : "text-danger"}`}>
              {result.status}
              {result.exit_code !== null && ` · exit code ${result.exit_code}`}
              {result.time_seconds !== null && ` · ${result.time_seconds}s`}
            </p>
            <Output label="Compiler" text={result.compile_output} danger />
            <Output label="Output" text={result.stdout} />
            <Output label="Errors" text={result.stderr} danger />
            {!result.stdout && !result.stderr && !result.compile_output && <p className="muted small">No output.</p>}
            {result.truncated && <p className="hint" style={{ margin: 0 }}>The output was too long and has been cut short.</p>}
          </>
        )}
      </div>
    </div>
  );
}

export default RunPanel;
