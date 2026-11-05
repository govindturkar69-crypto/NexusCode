import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { apiFetch } from "../api/client";
import { useAutosave } from "../editor/useAutosave";
import { useProject } from "../projects/useProject";
import Alert from "../components/ui/Alert";
import BackLink from "../components/ui/BackLink";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import Modal from "../components/ui/Modal";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
// Self-hosted Monaco (no CDN); must run before <Editor> mounts
import "../editor/monacoSetup";

// Same rule the backend enforces
const REPO_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

const LANGUAGES = [
  ["python", "Python"],
  ["javascript", "JavaScript"],
  ["java", "Java"],
  ["cpp", "C++"],
  ["html", "HTML"],
];

const SAVE_STATUS = {
  saved: { text: "All changes saved", className: "muted" },
  unsaved: { text: "Unsaved changes", className: "muted" },
  saving: { text: "Saving...", className: "muted" },
  error: { text: "Save failed", className: "text-danger" },
};

function CodeEditor() {
  const { projectId } = useParams();
  const { role, canEdit, isOwner } = useProject(projectId);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("python");
  const [loadState, setLoadState] = useState("loading"); // loading | ready | error
  const [loadError, setLoadError] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [showPush, setShowPush] = useState(false);
  const [pushedUrl, setPushedUrl] = useState("");

  useEffect(() => {
    apiFetch(`/projects/${projectId}/code`)
      .then((data) => {
        setCode(data.code_file?.content ?? "");
        setLanguage(data.code_file?.language ?? "python");
        setLoadState("ready");
      })
      .catch((err) => {
        setLoadError(err.message);
        setLoadState("error");
      });
  }, [projectId]);

  const save = useCallback(
    ({ content, language: lang }, { signal, keepalive } = {}) =>
      apiFetch(`/projects/${projectId}/code`, { method: "PUT", body: { content, language: lang }, signal, keepalive }),
    [projectId]
  );
  const autosave = useAutosave(save, { delay: 1000 });

  function handleCodeChange(value) {
    setCode(value ?? "");
    autosave.schedule({ content: value ?? "", language });
  }

  function handleLanguageChange(event) {
    const newLanguage = event.target.value;
    setLanguage(newLanguage);
    autosave.schedule({ content: code, language: newLanguage });
    autosave.flush();
  }

  function askAI(type) {
    setAiLoading(true);
    setAiResult("");
    const endpoint = type === "bugs" ? "detect-bugs" : "generate-docs";
    // Errors carry the backend's real message (e.g. quota exceeded, busy)
    apiFetch(`/ai/${endpoint}`, { method: "POST", body: { code } })
      .then((data) => setAiResult(data.result ?? ""))
      .catch((err) => setAiResult(err.message))
      .finally(() => setAiLoading(false));
  }

  const saveStatus = SAVE_STATUS[autosave.status];

  return (
    <Page width={1200}>
      <BackLink to={`/projects/${projectId}`}>Back to board</BackLink>
      <PageHeader
        eyebrow="code --edit"
        title="Code Editor"
        actions={
          <>
            <span role="status" aria-live="polite" className={`small ${saveStatus.className}`}>
              {role === "viewer" ? "View only" : saveStatus.text}
              {autosave.status === "error" && (
                <>
                  {`: ${autosave.error} `}
                  <Button variant="link" onClick={() => autosave.flush()}>Retry</Button>
                </>
              )}
            </span>
            <label className="visually-hidden" htmlFor="editor-language">Language</label>
            <select id="editor-language" className="input" style={{ width: "auto" }} value={language} onChange={handleLanguageChange} disabled={loadState !== "ready" || !canEdit}>
              {LANGUAGES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {isOwner && (
              <Button onClick={() => { setPushedUrl(""); setShowPush(true); }} disabled={loadState !== "ready"}>
                🐙 Push to GitHub
              </Button>
            )}
          </>
        }
      />

      {loadState === "error" && <Alert>Couldn&apos;t load the code: {loadError}</Alert>}
      {pushedUrl && (
        <Alert tone="success" onDismiss={() => setPushedUrl("")}>
          Pushed to GitHub. <a href={pushedUrl} target="_blank" rel="noreferrer" className="btn btn--link">Open the repository</a>
        </Alert>
      )}

      <div className="split split--wide-first">
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {loadState === "loading" ? (
            <p role="status" className="muted" style={{ padding: "1rem" }}>Loading code...</p>
          ) : (
            <Editor
              height="600px"
              language={language}
              value={code}
              onChange={handleCodeChange}
              theme="vs-dark"
              options={{ fontSize: 14, minimap: { enabled: false }, readOnly: loadState !== "ready" || !canEdit }}
            />
          )}
        </div>

        <div className="stack">
          <Button onClick={() => askAI("bugs")} disabled={aiLoading || loadState !== "ready"} block>
            🐛 Detect Bugs
          </Button>
          <Button onClick={() => askAI("docs")} disabled={aiLoading || loadState !== "ready"} block>
            📄 Generate Docs
          </Button>
          <Card className="grow" style={{ overflowY: "auto", maxHeight: "500px" }} aria-live="polite">
            {aiLoading && <p className="muted small">Thinking...</p>}
            {!aiLoading && !aiResult && <p className="muted small">AI results will appear here.</p>}
            {aiResult && <pre className="mono small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{aiResult}</pre>}
          </Card>
        </div>
      </div>

      {showPush && (
        <PushToGithubDialog
          projectId={projectId}
          onClose={() => setShowPush(false)}
          onPushed={(url) => {
            setShowPush(false);
            setPushedUrl(url);
          }}
        />
      )}
    </Page>
  );
}

function PushToGithubDialog({ projectId, onClose, onPushed }) {
  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function submit(event) {
    event.preventDefault();
    if (!REPO_NAME_PATTERN.test(repoName)) {
      setError("Use letters, numbers, '.', '-' and '_' only (max 100).");
      return;
    }
    setError("");
    setBusy(true);
    apiFetch(`/projects/${projectId}/push-to-github`, { method: "POST", body: { repo_name: repoName, private: isPrivate } })
      .then((data) => onPushed(data.repo_url))
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }

  return (
    <Modal title="Push to a new GitHub repository" onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="stack" noValidate>
        <Input
          label="Repository name"
          value={repoName}
          onChange={(e) => setRepoName(e.target.value)}
          placeholder="my-project"
          hint="Letters, numbers, '.', '-' and '_'"
          autoComplete="off"
        />
        <label className="checkbox">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          Private repository
        </label>
        {error && <p role="alert" className="small text-danger">{error}</p>}
        <div className="modal__actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !repoName}>{busy ? "Pushing..." : "Push"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default CodeEditor;
