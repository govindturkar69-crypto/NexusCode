import { useCallback, useEffect, useId, useRef, useState } from "react";
import { durationMs, motionAllowed } from "../../motion/motion";

// A menu button: the trigger gets aria-haspopup/aria-expanded, the list is
// role="menu" with role="menuitem" entries. Arrow keys, Home/End move; Enter/Space
// choose; Escape or Tab close and focus returns to the trigger. Opens with a
// drop-in, closes with a short fade.
//   items: [{ label, icon, onSelect, href (router Link not needed), tone: "danger", disabled }]
//   renderTrigger(props) -> a <button> (or Button) spreading props
//   align: "end" (default) | "start";  header: optional content above the items
function Menu({ label, items, renderTrigger, align = "end", header, className = "", menuClassName = "" }) {
  const [state, setState] = useState("closed"); // closed | open | closing
  const menuId = useId();
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const wrapRef = useRef(null);
  const open = state === "open";

  const close = useCallback(({ focusTrigger = true } = {}) => {
    if (!motionAllowed()) {
      setState("closed");
    } else {
      setState("closing");
      window.setTimeout(() => setState((s) => (s === "closing" ? "closed" : s)), durationMs("--duration-fast", 120));
    }
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const itemButtons = () => [...(listRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') ?? [])];

  useEffect(() => {
    if (!open) return undefined;
    itemButtons()[0]?.focus();
    function onPointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) close({ focusTrigger: false });
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  function onTriggerKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setState("open");
    }
  }

  function onMenuKeyDown(event) {
    const buttons = itemButtons();
    const index = buttons.indexOf(document.activeElement);
    const move = (to) => {
      event.preventDefault();
      buttons[(to + buttons.length) % buttons.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(buttons.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") close({ focusTrigger: false });
  }

  return (
    <div ref={wrapRef} className={`menu ${className}`}>
      {renderTrigger({
        ref: triggerRef,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : undefined,
        "aria-label": label,
        onClick: () => (open ? close() : setState("open")),
        onKeyDown: onTriggerKeyDown,
      })}
      {state !== "closed" && (
        <div className={`menu__popover menu__popover--${align} ${state === "closing" ? "is-closing" : ""} ${menuClassName}`}>
          {header}
          <ul ref={listRef} id={menuId} role="menu" aria-label={label} className="menu__list" onKeyDown={onMenuKeyDown}>
            {items.map((item, i) =>
              item.separator ? (
                <li key={`sep-${i}`} role="separator" className="menu__separator" />
              ) : (
                <li key={item.label} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    disabled={item.disabled}
                    className={`menu__item ${item.tone === "danger" ? "menu__item--danger" : ""}`}
                    onClick={() => {
                      close({ focusTrigger: !item.keepFocus });
                      item.onSelect?.();
                    }}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                </li>
              ),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default Menu;
