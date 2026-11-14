import { useState } from "react";
import { Bug, Check, Copy, FileText, Sparkles, Wand2 } from "lucide-react";
import { aiErrorText } from "../api/aiErrors";
import { apiFetch } from "../api/client";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import { LoadingRegion, SkeletonText } from "../components/ui/Skeleton";
import Tabs from "../components/ui/Tabs";

// Matches the backend cap (app/schemas/misc.py)
const MAX_INPUT_CHARS = 20000;

const TABS = {
  generate: {
    label: "Generate Code",
    Icon: Wand2,
    endpoint: "generate-code",
    bodyKey: "prompt",
    inputLabel: "What should the code do?",
    placeholder: "e.g. a function that reverses a linked list in Python",
  },
  bugs: {
    label: "Detect Bugs",
    Icon: Bug,
    endpoint: "detect-bugs",
    bodyKey: "code",
    inputLabel: "Code to check",
    placeholder: "Paste your code here to check for bugs...",
  },
  docs: {
    label: "Generate Docs",
    Icon: FileText,
    endpoint: "generate-docs",
    bodyKey: "code",
    inputLabel: "Code to document",
    placeholder: "Paste your code here to generate documentation...",
  },
};

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }, () => {});
  }
  return (
    <Button size="sm" variant="ghost" onClick={copy} icon={copied ? <Check size={13} className="motion-pop" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}>
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

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
    if (loading) return;
    setActiveTab(tab);
    setInput("");
    setResult("");
    setError("");
  }

  const tabs = Object.entries(TABS).map(([id, tab]) => ({ id, label: tab.label, icon: <tab.Icon size={15} aria-hidden="true" /> }));

  return (
    <Page width={840}>
      <PageHeader title="AI Assistant" description="Generate code, review it for bugs or write its documentation." />

      <Tabs label="AI tools" tabs={tabs} value={activeTab} onChange={switchTab}>
        {() => (
          <form onSubmit={handleSubmit} className="stack ai-form">
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
              <Button type="submit" loading={loading} disabled={!input.trim()} icon={<Sparkles size={15} aria-hidden="true" />}>
                {loading ? "Thinking..." : "Run"}
              </Button>
            </div>
          </form>
        )}
      </Tabs>

      <div aria-live="polite" className="ai-result-area">
        <Alert>{error}</Alert>
        {loading && (
          <LoadingRegion label="Waiting for the AI…">
            <Card aria-hidden="true"><SkeletonText lines={5} /></Card>
          </LoadingRegion>
        )}
        {result && (
          <Card className="ai-result motion-rise-in">
            <div className="ai-result__head">
              <h2 className="section-title">Result</h2>
              <CopyButton text={result} />
            </div>
            <pre className="mono small ai-result__body">{result}</pre>
          </Card>
        )}
      </div>
    </Page>
  );
}

export default AIAssistant;
