import { useState } from "react";
import { useNavigate } from "react-router-dom";

function AIAssistant() {
  const [activeTab, setActiveTab] = useState("generate");
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const token = localStorage.getItem("token");

  const tabConfig = {
    generate: {
      label: "Generate Code",
      endpoint: "generate-code",
      bodyKey: "prompt",
      placeholder: "e.g. a function that reverses a linked list in Python",
    },
    bugs: {
      label: "Detect Bugs",
      endpoint: "detect-bugs",
      bodyKey: "code",
      placeholder: "Paste your code here to check for bugs...",
    },
    docs: {
      label: "Generate Docs",
      endpoint: "generate-docs",
      bodyKey: "code",
      placeholder: "Paste your code here to generate documentation...",
    },
  };

  function handleSubmit() {
    if (!input.trim()) return;
    setLoading(true);
    setResult("");

    const config = tabConfig[activeTab];

    fetch(`http://127.0.0.1:8000/ai/${config.endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ [config.bodyKey]: input }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Request failed");
        return res.json();
      })
      .then((data) => setResult(data.result))
      .catch(() => setResult("Something went wrong. The AI service may be busy — try again."))
      .finally(() => setLoading(false));
  }

  function switchTab(tab) {
    setActiveTab(tab);
    setInput("");
    setResult("");
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0D1117", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: "800px", margin: "0 auto", padding: "3rem 1.5rem" }}>
        <button onClick={() => navigate("/projects")} style={backButtonStyle}>← All projects</button>

        <div style={{ marginTop: "0.5rem", marginBottom: "2rem" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", color: "#58A6FF", marginBottom: "0.3rem" }}>
            $ ai-assistant
          </div>
          <h1 style={{ fontFamily: "'JetBrains Mono', monospace", color: "#E6EDF3", fontSize: "24px", margin: 0, fontWeight: 600 }}>
            AI Assistant
          </h1>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
          {Object.keys(tabConfig).map((tab) => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              style={activeTab === tab ? activeTabStyle : tabStyle}
            >
              {tabConfig[tab].label}
            </button>
          ))}
        </div>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={tabConfig[activeTab].placeholder}
          rows={6}
          style={textareaStyle}
        />

        <button onClick={handleSubmit} disabled={loading} style={submitButtonStyle}>
          {loading ? "Thinking..." : "Run"}
        </button>

        {result && (
          <div style={resultBoxStyle}>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "#E6EDF3", fontSize: "13px", fontFamily: "'JetBrains Mono', monospace" }}>
              {result}
            </pre>
          </div>
        )}
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

const tabStyle = {
  padding: "8px 16px",
  background: "transparent",
  color: "#8B949E",
  border: "1px solid #30363D",
  borderRadius: "6px",
  fontSize: "13px",
  cursor: "pointer",
};

const activeTabStyle = {
  ...tabStyle,
  background: "#58A6FF",
  color: "#0D1117",
  borderColor: "#58A6FF",
  fontWeight: 600,
};

const textareaStyle = {
  width: "100%",
  padding: "12px",
  background: "#161B22",
  border: "1px solid #30363D",
  borderRadius: "8px",
  color: "#E6EDF3",
  fontSize: "14px",
  fontFamily: "'JetBrains Mono', monospace",
  outline: "none",
  boxSizing: "border-box",
  resize: "vertical",
  marginBottom: "1rem",
};

const submitButtonStyle = {
  padding: "10px 20px",
  background: "#58A6FF",
  color: "#0D1117",
  border: "none",
  borderRadius: "6px",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
};

const resultBoxStyle = {
  marginTop: "1.5rem",
  background: "#161B22",
  border: "1px solid #30363D",
  borderRadius: "8px",
  padding: "1.25rem",
  maxHeight: "500px",
  overflowY: "auto",
};

export default AIAssistant;