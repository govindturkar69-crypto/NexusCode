import { cloneElement, useEffect, useId, useRef, useState } from "react";

// A short text tip for an icon button or similar. Shows after a short hover delay,
// at once on keyboard focus, hides on Escape/blur/leave. Linked with
// aria-describedby; for icon-only buttons still give the button an aria-label.
// side: "top" (default) | "bottom"
function Tooltip({ label, side = "top", children }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (e) => e.key === "Escape" && setVisible(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible]);

  function show(delay) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(true), delay);
  }
  function hide() {
    window.clearTimeout(timer.current);
    setVisible(false);
  }

  // Only the description is added to the child; the events are caught on the wrapper
  const describedBy = [children.props["aria-describedby"], visible ? id : null].filter(Boolean).join(" ") || undefined;

  return (
    <span
      className="tooltip-anchor"
      onMouseEnter={() => show(400)}
      onMouseLeave={hide}
      onFocus={(e) => (e.target.matches?.(":focus-visible") ? show(0) : undefined)}
      onBlur={hide}
    >
      {cloneElement(children, { "aria-describedby": describedBy })}
      {visible && (
        <span role="tooltip" id={id} className={`tooltip tooltip--${side}`}>
          {label}
        </span>
      )}
    </span>
  );
}

export default Tooltip;
