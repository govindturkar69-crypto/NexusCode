import { useId, useState } from "react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";

// A labelled input (or a textarea with multiline). The label is tied to the control;
// hideLabel keeps it for screen readers only. `error` marks it invalid and is read
// out with the field. A password field gets a show/hide button.
function Input({ label, hint, error, hideLabel = false, multiline = false, id, className = "", type, ...props }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const [visible, setVisible] = useState(false);
  const isPassword = !multiline && type === "password";
  const Control = multiline ? "textarea" : "input";

  const control = (
    <Control
      id={inputId}
      className={`input ${error ? "input--invalid" : ""} ${isPassword ? "input--with-action" : ""}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      type={multiline ? undefined : isPassword && visible ? "text" : type}
      {...props}
    />
  );

  return (
    <div className={`field ${className}`}>
      {label && (
        <label htmlFor={inputId} className={hideLabel ? "visually-hidden" : "field__label"}>
          {label}
        </label>
      )}
      {isPassword ? (
        <div className="input-wrap">
          {control}
          <button
            type="button"
            className="input-wrap__action"
            onClick={() => setVisible((v) => !v)}
            aria-pressed={visible}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-controls={inputId}
          >
            {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        </div>
      ) : (
        control
      )}
      {error && (
        <p id={errorId} className="field__error" role="alert">
          <AlertCircle size={14} aria-hidden="true" /> {error}
        </p>
      )}
      {hint && <p id={hintId} className="hint">{hint}</p>}
    </div>
  );
}

export default Input;
