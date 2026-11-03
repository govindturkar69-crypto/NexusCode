import { useId } from "react";

// A labelled input (or textarea with multiline). The label is always tied to
// the control via htmlFor/id; pass hideLabel to keep it for screen readers only.
function Input({ label, hint, hideLabel = false, multiline = false, id, className = "", ...props }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const Control = multiline ? "textarea" : "input";
  return (
    <div className={`field ${className}`}>
      {label && (
        <label htmlFor={inputId} className={hideLabel ? "visually-hidden" : "field__label"}>
          {label}
        </label>
      )}
      <Control id={inputId} className="input" aria-describedby={hintId} {...props} />
      {hint && <p id={hintId} className="hint">{hint}</p>}
    </div>
  );
}

export default Input;
