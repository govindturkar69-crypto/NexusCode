import { useId } from "react";

// A labelled native <select>, styled like Input. Pass <option>s as children.
function Select({ label, hint, hideLabel = false, size, id, className = "", children, ...props }) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  return (
    <div className={`field ${className}`}>
      {label && (
        <label htmlFor={selectId} className={hideLabel ? "visually-hidden" : "field__label"}>
          {label}
        </label>
      )}
      <select id={selectId} className={`input select ${size === "sm" ? "input--sm" : ""}`} aria-describedby={hintId} {...props}>
        {children}
      </select>
      {hint && <p id={hintId} className="hint">{hint}</p>}
    </div>
  );
}

export default Select;
