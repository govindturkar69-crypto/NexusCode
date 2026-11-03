// variant: primary | ghost | danger | danger-solid | link ; size: sm | icon
function Button({ variant = "primary", size, block = false, className = "", type = "button", ...props }) {
  const classes = ["btn", `btn--${variant}`, size && `btn--${size}`, block && "btn--block", className]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} {...props} />;
}

export default Button;
