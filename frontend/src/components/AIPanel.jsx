import { useEffect, useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { aiErrorText } from "../api/aiErrors";
import { apiStream } from "../api/client";
import { useTheme } from "../theme/useTheme";
import AIMarkdown, { CopyButton } from "./AIMarkdown";
import Button from "./ui/Button";
import Modal from "./ui/Modal";

const ACTIONS = [
  ["explain", "💡 Explain"],
  ["bugs", "🐛 Find bugs"],
  ["docs", "📄 Generate docs"],
  ["tests", "🧪 Write tests"],
  ["refactor", "♻️ Refactor"],
];

// Matches the backend limit
const MAX_CONTEXT_FILES = 10;

// Code blocks in Markdown lose their final newline. Without this, every diff
// would show one, and applying would strip it from the file.
function matchFinalNewline(code, current) {
  return current?.endsWith("\n") && !code.endsWith("\n") ? `${code}\n` : code;
}

function DiffDialog({ path, language, original, modified, onApply, onClose }) {
  const { theme } = useTheme();
  return (
    <Modal
      title={`Apply to ${path}?`}
      wide
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} autoFocus>Cancel</Button>
          <Button onClick={onApply}>Apply changes</Button>
        </>
      }
    >
      <p className="muted small" style={{ marginBottom: "0.5rem" }}>
        Left is your file now, right is the AI's version. Applying replaces the whole file, and undo works in the editor.
      </p>
      <DiffEditor
        height="60vh"
        language={language}
        original={original}
        modified={modified}
        theme={theme === "dark" ? "vs-dark" : "light"}
        options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }}
      />
    </Modal>
  );
}

// beforeAsk saves changes first, because the server reads the files itself.
function AIPanel({ projectId, files, activeFile, activeContent, canEdit, beforeAsk, onApply }) {
  const [contextIds, setContextIds] = useState([]);
  const [reply, setReply] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [target, setTarget] = useState(null); // the file this reply is about
  const [proposal, setProposal] = useState(null);
  const controller = useRef(null);

  // Leaving the page ends the stream
  useEffect(() => () => controller.current?.abort(), []);

  const otherFiles = files.filter((file) => file.id !== activeFile?.id);
  const chosen = contextIds.filter((id) => otherFiles.some((file) => file.id === id));

  function toggleContext(id) {
    setContextIds((prev) => (prev.includes(id) ? prev.filter((other) => other !== id) : [...prev, id]));
  }

  function ask(action) {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setReply("");
    setError("");
    setStreaming(true);
    setTarget(activeFile);
    beforeAsk()
      .then(() =>
        apiStream(`/ai/projects/${projectId}/stream`, {
          body: { action, file_id: activeFile.id, context_file_ids: chosen },
          signal: ctrl.signal,
          onEvent: ({ event, data }) => {
            if (event === "delta") setReply((prev) => prev + data.text);
            else if (event === "error") setError(data.detail);
          },
        })
      )
      .catch((err) => {
        // Pressing Stop isn't a failure
        if (err.name !== "AbortError") setError(aiErrorText(err));
      })
      .finally(() => {
        if (controller.current === ctrl) setStreaming(false);
      });
  }

  const onTargetFile = target !== null && activeFile?.id === target.id;
  const canApply = canEdit && !streaming && onTargetFile;

  return (
    <div className="stack ai-panel">
      <div className="ai-panel__actions">
        {ACTIONS.map(([action, label]) => (
          <Button key={action} size="sm" onClick={() => ask(action)} disabled={streaming || !activeFile}>{label}</Button>
        ))}
      </div>

      {otherFiles.length > 0 && (
        <details className="small">
          <summary>Also include other files ({chosen.length})</summary>
          <ul className="ai-panel__files">
            {otherFiles.map((file) => (
              <li key={file.id}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={chosen.includes(file.id)}
                    disabled={!chosen.includes(file.id) && chosen.length >= MAX_CONTEXT_FILES}
                    onChange={() => toggleContext(file.id)}
                  />
                  {file.path}
                </label>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="card ai-panel__reply" aria-live="polite" aria-busy={streaming}>
        {!reply && !error && !streaming && <p className="muted small">Pick an action. The AI reads the open file, plus any you include above.</p>}
        {!reply && streaming && <p className="muted small">Thinking...</p>}
        {reply && (
          <AIMarkdown
            text={reply}
            applyLabel="Apply to editor"
            onApply={canApply ? (code) => setProposal(matchFinalNewline(code, activeContent)) : undefined}
          />
        )}
        {error && <p role="alert" className="small text-danger">{error}</p>}
      </div>

      <div className="row" style={{ "--gap": "0.5rem" }}>
        {streaming && <Button size="sm" variant="ghost" onClick={() => controller.current?.abort()}>■ Stop</Button>}
        {reply && !streaming && <CopyButton text={reply} label="Copy reply" />}
        {reply && !streaming && canEdit && target && !onTargetFile && (
          <span className="hint" style={{ margin: 0 }}>Open {target.path} again to apply code from this reply.</span>
        )}
      </div>

      {proposal !== null && onTargetFile && (
        <DiffDialog
          path={activeFile.path}
          language={activeFile.language ?? "plaintext"}
          original={activeContent ?? ""}
          modified={proposal}
          onClose={() => setProposal(null)}
          onApply={() => {
            onApply(proposal);
            setProposal(null);
          }}
        />
      )}
    </div>
  );
}

export default AIPanel;
