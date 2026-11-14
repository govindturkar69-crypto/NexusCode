// Once the browser is idle (e.g. on the landing page): fetch the sign-in chunk
// (Its own module: only the lazily loaded landing page uses it.)
export function prefetchWhenIdle(loader) {
  const go = () => loader().catch(() => {});
  if (typeof window === "undefined") return () => {};
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(go, { timeout: 3000 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(go, 1500);
  return () => window.clearTimeout(id);
}
