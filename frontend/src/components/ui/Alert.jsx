// tone: error (announced immediately) | success | info (polite status)
function Alert({ tone = "error", onDismiss, children }) {
  if (!children) return null;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`alert alert--${tone} row row--between`}>
      <span>{children}</span>
      {onDismiss && (
        <button type="button" className="btn btn--ghost btn--icon" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}

export default Alert;
