// The sign-in pages' chunk loaders, shared by the router (lazy) and by links that
// warm them up early (hover, focus, touch, idle), so opening them is instant.
// import() caches its promise, so calling a loader twice downloads once.

export const loadLogin = () => import("../pages/Login");
export const loadAccountPages = () => import("../pages/AccountPages");

// Spread onto a link: <Link to="/login" {...prefetchOn(loadLogin)}>
export function prefetchOn(loader) {
  const go = () => {
    loader().catch(() => {});
  };
  return { onMouseEnter: go, onFocus: go, onTouchStart: go };
}
