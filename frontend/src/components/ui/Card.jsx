// A surface. With onClick it becomes keyboard-operable (Enter/Space) and is
// announced as a button, so clickable cards work without a mouse.
function Card({ as: Tag = "div", onClick, className = "", children, ...props }) {
  const interactive = typeof onClick === "function";
  const handleKeyDown = interactive
    ? (event) => {
        if (event.target !== event.currentTarget) return; // let inner buttons handle their own keys
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(event);
        }
      }
    : undefined;
  return (
    <Tag
      className={`card ${interactive ? "card--interactive" : ""} ${className}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      {...props}
    >
      {children}
    </Tag>
  );
}

export default Card;
