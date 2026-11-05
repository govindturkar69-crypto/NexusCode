import { isValidElement, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Button from "./ui/Button";

// AI replies can be influenced by the code they read, so they're treated as
// untrusted. react-markdown never renders raw HTML. Images are dropped because
// just loading one could send data to a server named in the reply.
const NOT_ALLOWED = ["img"];

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return <Button size="sm" variant="ghost" onClick={copy}>{copied ? "Copied" : label}</Button>;
}

function blockText(children) {
  const code = Array.isArray(children) ? children.find(isValidElement) : children;
  if (!isValidElement(code)) return "";
  const text = code.props.children;
  const joined = Array.isArray(text) ? text.join("") : String(text ?? "");
  return joined.replace(/\n$/, "");
}

function AIMarkdown({ text, applyLabel, onApply }) {
  const components = {
    pre({ children }) {
      const code = blockText(children);
      return (
        <div className="ai-code">
          <div className="ai-code__actions">
            <CopyButton text={code} />
            {onApply && <Button size="sm" onClick={() => onApply(code)}>{applyLabel}</Button>}
          </div>
          <pre className="ai-code__body">{children}</pre>
        </div>
      );
    },
    a({ href, children }) {
      return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
    },
  };

  return (
    <div className="ai-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} disallowedElements={NOT_ALLOWED} unwrapDisallowed components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export { CopyButton };
export default AIMarkdown;
