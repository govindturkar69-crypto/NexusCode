import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { apiFetch } from "../api/client";
// Self-hosted Monaco (no CDN); must run before <Editor> mounts
import "../editor/monacoSetup";

// Same rule the backend enforces
const REPO_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

function CodeEditor() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("python");
  const [saveStatus, setSaveStatus] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [pushPrivate, setPushPrivate] = useState(true);

  const saveTimeout = useRef(null);

  useEffect(() => {
    apiFetch(`/projects/${projectId}/code`)
      .then((data) => {
        setCode(data.code_file?.content ?? "");
        setLanguage(data.code_file?.language ?? "python");
      })
      .catch((err) => setSaveStatus(`Couldn't load code: ${err.message}`));
  }, [projectId]);

  function saveCode(newCode, newLanguage) {
    setSaveStatus("Saving...");
    apiFetch(`/projects/${projectId}/code`, {
      method: "PUT",
      body: { content: newCode, language: newLanguage },
    })
      .then(() => setSaveStatus("Saved"))
      .catch((err) => setSaveStatus(`Save failed: ${err.message}`));
  }

  // Debounced auto-save: waits 1 second after the user stops typing before saving,
  // instead of saving on every single keystroke (which would overload the server).
  function handleCodeChange(value) {
    setCode(value);
    setSaveStatus("Editing...");

    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      saveCode(value, language);
    }, 1000);
  }

  function handleLanguageChange(e) {
    const newLang = e.target.value;
    setLanguage(newLang);
    saveCode(code, newLang);
  }

  function pushToGithub() {
    const repoName = prompt("Enter a name for the new GitHub repository:");
    if (!repoName) return;
    if (!REPO_NAME_PATTERN.test(repoName)) {
      setSaveStatus("Repo name may only use letters, numbers, '.', '-' and '_' (max 100).");
      return;
    }

    setSaveStatus("Pushing to GitHub...");
    apiFetch(`/projects/${projectId}/push-to-github`, {
      method: "POST",
      body: { repo_name: repoName, private: pushPrivate },
    })
      .then((data) => {
        setSaveStatus("Pushed!");
        window.open(data.repo_url, "_blank");
      })
      .catch((err) => setSaveStatus(err.message));
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

  return (
    <div style={{ minHeight: "100vh", background: "#0D1117", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <button onClick={() => navigate(`/projects/${projectId}`)} style={backButtonStyle}>← Back to board</button>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "1rem 0 1.5rem" }}>
          <h1 style={{ fontFamily: "'JetBrains Mono', monospace", color: "#E6EDF3", fontSize: "22px", margin: 0, fontWeight: 600 }}>
            Code Editor
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <span style={{ color: "#8B949E", fontSize: "12px" }}>{saveStatus}</span>
            <select value={language} onChange={handleLanguageChange} style={selectStyle}>
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
              <option value="java">Java</option>
              <option value="cpp">C++</option>
              <option value="html">HTML</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", color: "#8B949E", fontSize: "13px", cursor: "pointer" }}>
              <input type="checkbox" checked={pushPrivate} onChange={(e) => setPushPrivate(e.target.checked)} />
              Private repo
            </label>
            <button onClick={pushToGithub} style={{ ...selectStyle, cursor: "pointer", background: "#58A6FF", color: "#0D1117", fontWeight: 600 }}>
              🐙 Push to GitHub
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "1rem" }}>
          <div style={{ flex: 2, border: "1px solid #30363D", borderRadius: "10px", overflow: "hidden" }}>
            <Editor
              height="600px"
              language={language}
              value={code}
              onChange={handleCodeChange}
              theme="vs-dark"
              options={{ fontSize: 14, minimap: { enabled: false } }}
            />
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <button onClick={() => askAI("bugs")} disabled={aiLoading} style={aiButtonStyle}>
              🐛 Detect Bugs
            </button>
            <button onClick={() => askAI("docs")} disabled={aiLoading} style={aiButtonStyle}>
              📄 Generate Docs
            </button>

            <div style={resultBoxStyle}>
              {aiLoading && <p style={{ color: "#8B949E", fontSize: "13px" }}>Thinking...</p>}
              {!aiLoading && !aiResult && (
                <p style={{ color: "#8B949E", fontSize: "13px" }}>AI results will appear here.</p>
              )}
              {aiResult && (
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "#E6EDF3", fontSize: "12px", fontFamily: "'JetBrains Mono', monospace" }}>
                  {aiResult}
                </pre>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const backButtonStyle = {
  padding: "0",
  background: "transparent",
  color: "#58A6FF",
  border: "none",
  fontSize: "13px",
  cursor: "pointer",
};

const selectStyle = {
  padding: "6px 10px",
  background: "#161B22",
  border: "1px solid #30363D",
  borderRadius: "6px",
  color: "#E6EDF3",
  fontSize: "13px",
};

const aiButtonStyle = {
  padding: "10px",
  background: "#58A6FF",
  color: "#0D1117",
  border: "none",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

const resultBoxStyle = {
  background: "#161B22",
  border: "1px solid #30363D",
  borderRadius: "8px",
  padding: "1rem",
  flex: 1,
  overflowY: "auto",
  maxHeight: "500px",
};

export default CodeEditor;