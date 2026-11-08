import { useEffect, useState } from "react";

// Email links carry their token in the URL fragment, which browsers never send to
// servers or in Referer headers.

export function readFragmentParam(name) {
  return new URLSearchParams(window.location.hash.slice(1)).get(name);
}

export function clearFragment() {
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

// Reads once, then removes the fragment from the address bar so it isn't bookmarked,
// shared or left in history. Reading is kept free of side effects, because React
// may run state initialisers twice in development.
export function useFragmentParam(name) {
  const [value] = useState(() => readFragmentParam(name));
  useEffect(() => {
    clearFragment();
  }, []);
  return value;
}
