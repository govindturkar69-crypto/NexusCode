// A small status label. Pair colour with text (and optionally an icon) so colour
// is never the only signal.
// tone: neutral | accent | success | danger | warning ; variant: soft (default) | outline
function Badge({ tone = "neutral", variant = "soft", icon, className = "", children, ...props }) {
  return (
    <span className={`badge badge--${tone} ${variant === "outline" ? "badge--outline" : ""} ${className}`} {...props}>
      {icon}
      {children}
    </span>
  );
}

export default Badge;
