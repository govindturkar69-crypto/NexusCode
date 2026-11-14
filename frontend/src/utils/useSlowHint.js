import { useEffect, useState } from "react";

// True once something has been going for `delayMs` (e.g. a request to a
// sleeping server). Pass a key that is new for each attempt (such as the time it
// started) while it runs, and null when it isn't running.
export function useSlowHint(activeKey, delayMs = 2500) {
  const [firedFor, setFiredFor] = useState(null);
  useEffect(() => {
    if (activeKey == null) return undefined;
    const timer = setTimeout(() => setFiredFor(activeKey), delayMs);
    return () => clearTimeout(timer);
  }, [activeKey, delayMs]);
  return activeKey != null && firedFor === activeKey;
}

export const WAKING_TEXT = "Waking up the server, this can take up to a minute…";
