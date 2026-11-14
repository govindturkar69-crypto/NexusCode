import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

const ICONS = { error: AlertCircle, success: CheckCircle2, info: Info };

// tone: error (announced immediately) | success | info (polite status).
// An icon goes with the colour, so the tone isn't shown by colour alone.
function Alert({ tone = "error", onDismiss, children }) {
  if (!children) return null;
  const Icon = ICONS[tone] ?? Info;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`alert alert--${tone}`}>
      <Icon size={16} className="alert__icon" aria-hidden="true" />
      <span>{children}</span>
      {onDismiss && (
        <button type="button" className="btn btn--subtle btn--icon" onClick={onDismiss} aria-label="Dismiss">
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default Alert;
