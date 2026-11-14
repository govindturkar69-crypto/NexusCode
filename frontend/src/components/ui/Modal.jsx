import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { animateOut } from "../../motion/animateOut";

// Accessible dialog: role="dialog" + aria-modal, labelled by its title. Escape, the
// close button and a backdrop click close it; focus moves inside on open, Tab stays
// inside, and focus returns to what was focused before. It is rendered into <body>
// (so no transformed parent can shift it), scales in, and fades out when removed.
// size: "md" (default) | "lg" | "wide"
function Modal({ title, description, onClose, children, actions, wide = false, size, hideClose = false }) {
  const titleId = useId();
  const descriptionId = useId();
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const dialog = dialogRef.current;
    const focusables = () =>
      [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (el) => !el.disabled && !el.closest(".modal__close")
      );
    (dialog.querySelector("[autofocus], input, textarea") ?? focusables()[0] ?? dialog).focus();

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        const items = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    dialog.addEventListener("keydown", onKeyDown);
    // The page behind doesn't scroll while a dialog is open
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  // Exit animation: runs while the nodes are still in the document
  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    return () => animateOut(backdrop, { keyframes: [{ opacity: 1 }, { opacity: 0 }] });
  }, []);

  const sizeClass = wide || size === "wide" ? "modal--wide" : size === "lg" ? "modal--lg" : "";

  return createPortal(
    <div ref={backdropRef} className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={`modal ${sizeClass}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <h2 id={titleId} className="modal__title">{title}</h2>
        {description && <p id={descriptionId} className="modal__description">{description}</p>}
        <div className="modal__body">{children}</div>
        {actions && <div className="modal__actions">{actions}</div>}
        {/* Last in the Tab order, shown top-right */}
        {!hideClose && (
          <button type="button" className="modal__close" onClick={() => onClose()} aria-label="Close dialog">
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default Modal;
