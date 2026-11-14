// A small spinner. With a label it is announced (role="status"); without one it is
// decorative, for use inside something that already says it's busy (e.g. a Button).
function Spinner({ size = 16, label, className = "" }) {
  const svg = (
    <svg className={`spinner ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  if (!label) return svg;
  return (
    <span role="status" className="spinner-wrap">
      {svg}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

export default Spinner;
