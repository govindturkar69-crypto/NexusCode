import { useEffect, useRef } from "react";

// Reveals an element the first time it scrolls into view (once, never again).
// Only an element that starts BELOW the fold is hidden first, so nothing on the
// first screen waits on JavaScript and the largest paint isn't delayed. Without
// IntersectionObserver, or with reduced motion handled in CSS, it simply shows.
export function useReveal({ rootMargin = "0px 0px -10% 0px" } = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return undefined;
    const belowFold = element.getBoundingClientRect().top > window.innerHeight;
    if (!belowFold) return undefined;

    element.classList.add("reveal-pending");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          element.classList.add("reveal-in");
          element.classList.remove("reveal-pending");
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      element.classList.remove("reveal-pending");
    };
  }, [rootMargin]);

  return ref;
}
