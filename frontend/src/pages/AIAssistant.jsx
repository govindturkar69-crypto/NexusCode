import { useState } from "react";
import { aiErrorText } from "../api/aiErrors";
import { apiFetch } from "../api/client";
import BackLink from "../components/ui/BackLink";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";

// Matches the backend cap (app/schemas/misc.py)
const MAX_INPUT_CHARS = 20000;

const TABS = {
  generate: {
    label: "Generate Code",
    endpoint: "generate-code",
    bodyKey: "prompt",
    inputLabel: "What should the code do?",
    placeholder: "e.g. a function that reverses a linked list in Python",
  },
  bugs: {
    label: "Detect Bugs",
    endpoint: "detect-bugs",
    bodyKey: "code",
    inputLabel: "Code to check",
    placeholder: "Paste your code here to check for bugs...",
  },
  docs: {
    label: "Generate Docs",
    endpoint: "generate-docs",
    bodyKey: "code",
    inputLabel: "Code to document",
    placeholder: "Paste your code here to generate documentation...",
  },
};

function AIAssistant() {
  const [activeTab, setActiveTab] = useState("generate");
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const config = TABS[activeTab];

  function handleSubmit(event) {
    event.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    setResult("");
    setError("");
    apiFetch(`/ai/${config.endpoint}`, { method: "POST", body: { [config.bodyKey]: input } })
      .then((data) => setResult(data.result ?? ""))
      .catch((err) => setError(aiErrorText(err, "Something went wrong. The AI service may be busy — try again.")))
      .finally(() => setLoading(false));
  }

  function switchTab(tab) {
    setActiveTab(tab);
    setInput("");
    setResult("");
    setError("");
  }

  return (
    <Page width={800}>
      <BackLink to="/projects">All projects</BackLink>
      <PageHeader eyebrow="ai-assistant" title="AI Assistant" />

      <div role="tablist" aria-label="AI tools" className="row" style={{ marginBottom: "1.5rem" }}>
        {Object.entries(TABS).map(([key, tab]) => (
          <Button
            key={key}
            role="tab"
            id={`ai-tab-${key}`}
            aria-selected={activeTab === key}
            aria-controls="ai-panel"
            variant={activeTab === key ? "primary" : "ghost"}
            onClick={() => switchTab(key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <form id="ai-panel" role="tabpanel" aria-labelledby={`ai-tab-${activeTab}`} onSubmit={handleSubmit} className="stack">
        <Input
          multiline
          rows={8}
          label={config.inputLabel}
          placeholder={config.placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={MAX_INPUT_CHARS}
          hint={`${input.length.toLocaleString()} / ${MAX_INPUT_CHARS.toLocaleString()} characters`}
        />
        <div>
          <Button type="submit" disabled={loading || !input.trim()}>{loading ? "Thinking..." : "Run"}</Button>
        </div>
      </form>

      <div aria-live="polite" style={{ marginTop: "1.5rem" }}>
        {error && <p role="alert" className="small text-danger">{error}</p>}
        {result && (
          <Card style={{ maxHeight: "500px", overflowY: "auto" }}>
            <pre className="mono small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{result}</pre>
          </Card>
        )}
      </div>
    </Page>
  );
}

export default AIAssistant;
