import { durationMs, motionAllowed } from "./motion";

// Plays an exit animation for an element that React is about to remove: a copy of it
// is left in place (inert, not clickable, hidden from assistive tech), animated out
// with the Web Animations API, then removed. The real element unmounts at once, so
// nothing waits on the animation and focus is never trapped in a ghost.
export function animateOut(element, { keyframes, parent = document.body, token = "--duration-fast" } = {}) {
  if (!element || !motionAllowed() || typeof element.animate !== "function") return;
  const ghost = element.cloneNode(true);
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("inert", "");
  ghost.style.pointerEvents = "none";
  ghost.removeAttribute("id");
  for (const el of ghost.querySelectorAll("[id]")) el.removeAttribute("id");
  parent.appendChild(ghost);
  const animation = ghost.animate(keyframes ?? [{ opacity: 1 }, { opacity: 0 }], {
    duration: durationMs(token, 120),
    easing: "cubic-bezier(0.7, 0, 0.84, 0)",
    fill: "forwards",
  });
  const remove = () => ghost.remove();
  animation.onfinish = remove;
  animation.oncancel = remove;
  // Safety net if the animation never finishes (e.g. a background tab)
  window.setTimeout(remove, 1000);
}
