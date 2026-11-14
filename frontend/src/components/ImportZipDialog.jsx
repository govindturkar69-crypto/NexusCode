import { useRef, useState } from "react";
import { CheckCircle2, FileArchive, FilePlus2, FileWarning, Upload } from "lucide-react";
import { MAX_IMPORT_BYTES, uploadProjectZip } from "../api/archive";
import Alert from "./ui/Alert";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import Modal from "./ui/Modal";
import "../styles/archive.css";

const kb = (bytes) => (bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`);

function Progress({ value, label }) {
  return (
    <div className="zip-progress">
      <progress max={1} value={value ?? undefined} aria-label={label} />
      <span className="small muted">{label}{value != null ? ` ${Math.round(value * 100)}%` : ""}</span>
    </div>
  );
}

// Import a ZIP into the project's code. The server checks everything (twice:
// on the preview and again on the import); this only shows what it said.
function ImportZipDialog({ projectId, onClose, onImported }) {
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [step, setStep] = useState("choose"); // choose | previewing | review | importing | done
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState(null);
  const [choices, setChoices] = useState({}); // duplicate path -> "skip" | "rename"
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const busy = step === "previewing" || step === "importing";

  function preview(chosen) {
    setError("");
    if (!chosen) return;
    if (!/\.zip$/i.test(chosen.name)) {
      setError("Choose a .zip file.");
      return;
    }
    if (chosen.size > MAX_IMPORT_BYTES) {
      setError(`That ZIP is ${Math.round(chosen.size / 1024 / 1024)} MB; the limit is 5 MB.`);
      return;
    }
    setFile(chosen);
    setStep("previewing");
    setProgress(0);
    uploadProjectZip(projectId, chosen, { dryRun: true, onProgress: setProgress })
      .then((data) => {
        setReport(data);
        setChoices(Object.fromEntries(data.entries.filter((e) => e.status === "duplicate").map((e) => [e.path, "skip"])));
        setStep("review");
      })
      .catch((err) => {
        setError(err.message);
        setStep("choose");
      });
  }

  function runImport() {
    setError("");
    setStep("importing");
    setProgress(0);
    uploadProjectZip(projectId, file, { dryRun: false, decisions: choices, onProgress: setProgress })
      .then((data) => {
        setResult(data);
        setStep("done");
        onImported?.(data);
      })
      .catch((err) => {
        setError(err.message);
        setStep("review");
      });
  }

  const entries = report?.entries ?? [];
  const fresh = entries.filter((e) => e.status === "new");
  const duplicates = entries.filter((e) => e.status === "duplicate");
  const skipped = entries.filter((e) => e.status === "skipped");
  const renaming = duplicates.filter((e) => choices[e.path] === "rename").length;
  const toImport = fresh.length + renaming;
  const setAll = (value) => setChoices(Object.fromEntries(duplicates.map((e) => [e.path, value])));

  return (
    <Modal title="Import a ZIP" description="Add the text and code files from a ZIP to this project. Nothing changes until you confirm." size="lg" onClose={busy ? () => {} : onClose}>
      <div className="stack zip-dialog" style={{ "--gap": "1rem" }}>
        {(step === "choose" || step === "previewing") && (
          <>
            <div className="zip-drop">
              <FileArchive size={28} aria-hidden="true" />
              <p className="small muted" style={{ margin: 0 }}>Up to 5 MB, 300 entries and 1 MB per file. Binary files, symlinks and paths outside the project are skipped.</p>
              <input ref={input} type="file" accept=".zip,application/zip" className="visually-hidden" id="zip-file" onChange={(e) => preview(e.target.files?.[0])} disabled={busy} />
              <Button icon={<Upload size={15} aria-hidden="true" />} loading={step === "previewing"} onClick={() => input.current?.click()}>
                {step === "previewing" ? "Checking the ZIP..." : "Choose a ZIP"}
              </Button>
            </div>
            {step === "previewing" && <Progress value={progress < 1 ? progress : null} label={progress < 1 ? "Uploading" : "Checking files"} />}
          </>
        )}

        <Alert>{error}</Alert>

        {(step === "review" || step === "importing") && report && (
          <>
            <p className="zip-summary" role="status">
              <strong>{file?.name}</strong>: <Badge tone="success">{fresh.length} new</Badge> <Badge tone="warning">{duplicates.length} already exist</Badge> <Badge>{skipped.length} skipped</Badge>
            </p>
            {fresh.length > 0 && (
              <details className="zip-group" open={fresh.length <= 12}>
                <summary><FilePlus2 size={14} aria-hidden="true" /> New files ({fresh.length})</summary>
                <ul className="zip-list">
                  {fresh.map((e) => <li key={e.path}><span className="mono">{e.path}</span><span className="small muted">{kb(e.size)}</span></li>)}
                </ul>
              </details>
            )}
            {duplicates.length > 0 && (
              <fieldset className="zip-group zip-group--dupes">
                <legend>Already in the project ({duplicates.length})</legend>
                <div className="row small" style={{ "--gap": "0.5rem" }}>
                  <span className="muted">For all:</span>
                  <Button size="sm" variant="ghost" onClick={() => setAll("skip")} disabled={busy}>Skip all</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAll("rename")} disabled={busy}>Keep both (rename)</Button>
                </div>
                <ul className="zip-list">
                  {duplicates.map((e) => (
                    <li key={e.path}>
                      <span className="mono">{e.path}</span>
                      <label className="visually-hidden" htmlFor={`dup-${e.path}`}>What to do with {e.path}</label>
                      <select id={`dup-${e.path}`} className="input input--sm" value={choices[e.path]} disabled={busy} onChange={(ev) => setChoices({ ...choices, [e.path]: ev.target.value })}>
                        <option value="skip">Skip (keep the project's)</option>
                        <option value="rename">Import as a copy</option>
                      </select>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
            {skipped.length > 0 && (
              <details className="zip-group">
                <summary><FileWarning size={14} aria-hidden="true" /> Skipped ({skipped.length})</summary>
                <ul className="zip-list">
                  {skipped.map((e, i) => <li key={`${e.path}-${i}`}><span className="mono">{e.path}</span><span className="small muted">{e.reason}</span></li>)}
                </ul>
              </details>
            )}
            {step === "importing" && <Progress value={progress < 1 ? progress : null} label={progress < 1 ? "Uploading" : "Creating files"} />}
            <div className="modal__actions" style={{ marginTop: 0 }}>
              <Button variant="secondary" onClick={() => { setStep("choose"); setReport(null); setFile(null); }} disabled={busy}>Choose another</Button>
              <Button onClick={runImport} loading={step === "importing"} disabled={toImport === 0}>
                {toImport === 0 ? "Nothing to import" : `Import ${toImport} file${toImport === 1 ? "" : "s"}`}
              </Button>
            </div>
          </>
        )}

        {step === "done" && result && (
          <>
            <Alert tone="success">
              Imported {result.created.length} file{result.created.length === 1 ? "" : "s"}
              {result.renamed.length > 0 ? ` (${result.renamed.length} as renamed copies)` : ""}.
              {result.skipped.length > 0 ? ` ${result.skipped.length} skipped.` : ""}
            </Alert>
            {result.created.length > 0 && (
              <ul className="zip-list zip-list--done" aria-label="Imported files">
                {result.created.map((path) => <li key={path}><CheckCircle2 size={14} aria-hidden="true" /><span className="mono">{path}</span></li>)}
              </ul>
            )}
            <div className="modal__actions" style={{ marginTop: 0 }}>
              <Button onClick={onClose}>Done</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default ImportZipDialog;
