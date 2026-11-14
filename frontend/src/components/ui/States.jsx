import { AlertTriangle, RotateCw } from "lucide-react";
import Button from "./Button";

// Nothing here yet: an icon, a heading, a sentence and (usually) the action to fix it.
export function EmptyState({ icon, title, children, action, compact = false, headingLevel = 2 }) {
  const Heading = `h${headingLevel}`;
  return (
    <div className={`state ${compact ? "state--compact" : ""} motion-fade-in`}>
      {icon && <span className="state__icon" aria-hidden="true">{icon}</span>}
      <Heading className="state__title">{title}</Heading>
      {children && <div className="state__text">{children}</div>}
      {action && <div className="state__action">{action}</div>}
    </div>
  );
}

// Something failed: say what, in plain words, and offer to try again.
export function ErrorState({ title = "Something went wrong", message, onRetry, retryLabel = "Try again", compact = false, headingLevel = 2 }) {
  const Heading = `h${headingLevel}`;
  return (
    <div className={`state state--error ${compact ? "state--compact" : ""} motion-fade-in`} role="alert">
      <span className="state__icon" aria-hidden="true"><AlertTriangle size={compact ? 20 : 28} /></span>
      <Heading className="state__title">{title}</Heading>
      {message && <div className="state__text">{message}</div>}
      {onRetry && (
        <div className="state__action">
          <Button variant="secondary" icon={<RotateCw size={14} aria-hidden="true" />} onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
