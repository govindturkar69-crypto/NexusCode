import Spinner from "./Spinner";

// variant: primary | secondary | ghost | subtle | danger | danger-solid | link
// size: sm | md | lg | icon (square; give it an aria-label)
// loading: shows a spinner, keeps the width, disables the button and sets aria-busy
// icon: an element shown before the label (e.g. a lucide icon)
function Button({
  variant = "primary",
  size,
  block = false,
  loading = false,
  icon,
  className = "",
  type = "button",
  disabled,
  children,
  ...props
}) {
  const classes = ["btn", `btn--${variant}`, size && `btn--${size}`, block && "btn--block", loading && "btn--loading", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <Spinner size={size === "sm" ? 12 : 14} className="btn__spinner" /> : icon}
      {children}
    </button>
  );
}

export default Button;
