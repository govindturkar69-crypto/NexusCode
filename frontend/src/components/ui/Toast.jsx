import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { durationMs, motionAllowed } from "../../motion/motion";
import { ToastContext } from "./toastContext";

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };
const MAX_TOASTS = 4;

function ToastItem({ toast, onDismiss }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);
  const started = useRef(0);
  const Icon = ICONS[toast.tone] ?? Info;

  useEffect(() => {
    if (paused || toast.leaving || !toast.duration) return undefined;
    started.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started.current;
    };
  }, [paused, toast.leaving, toast.duration, toast.id, onDismiss]);

  return (
    <li
      className={`toast toast--${toast.tone} ${toast.leaving ? "is-leaving" : ""}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon size={18} className="toast__icon" aria-hidden="true" />
      <div className="toast__text">
        <p className="toast__title">{toast.title}</p>
        {toast.description && <p className="toast__description">{toast.description}</p>}
      </div>
      <button type="button" className="toast__close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
        <X size={16} aria-hidden="true" />
      </button>
      {toast.duration > 0 && (
        <span
          className="toast__progress"
          aria-hidden="true"
          style={{ animationDuration: `${toast.duration}ms`, animationPlayState: paused ? "paused" : "running" }}
        />
      )}
    </li>
  );
}

// Short-lived messages ("Saved", "Couldn't delete"). The list is a polite live
// region, so screen readers hear each one without losing their place.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    if (!motionAllowed()) {
      setToasts((list) => list.filter((t) => t.id !== id));
      return;
    }
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), durationMs("--duration-base", 200));
  }, []);

  const toast = useCallback(({ title, description, tone = "info", duration = 4000 }) => {
    const id = nextId.current++;
    setToasts((list) => [...list, { id, title, description, tone, duration }].slice(-MAX_TOASTS));
    return id;
  }, []);

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite" aria-label="Status messages">
        <ol className="toast-list">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </ol>
      </div>
    </ToastContext.Provider>
  );
}

export default ToastProvider;
