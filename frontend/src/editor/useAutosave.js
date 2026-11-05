import { useCallback, useEffect, useRef, useState } from "react";

const SAVED = { status: "saved", error: "" };

/**
 * Debounced autosave, kept separately for each file.
 *
 *   const autosave = useAutosave(save, { delay: 1000 })
 *   autosave.schedule(key, value) -> saves `delay` ms after that key's last change
 *   autosave.flush(key)           -> saves that key now; resolves when it settles
 *   autosave.forget(key)          -> drops it, unsaved changes included (file deleted)
 *   autosave.state(key)           -> { status, error }
 *   autosave.pendingError(key)    -> the last save's error if it's still unsaved, right
 *                                    now rather than on the next render
 *
 * save(key, value, { signal, keepalive }) must return a promise that rejects on
 * failure (apiFetch does). Guarantees, for each key:
 * - a newer save aborts the one in flight and waits for it to settle first,
 *   so saves leave the browser in order and an old one can't overwrite a newer one
 * - failures keep the value pending and report status "error"
 * - unsaved changes are flushed on unmount and when the tab is closed
 *   (with keepalive so the request survives the page going away), and the
 *   browser warns before closing with unsaved changes
 *
 * status: "saved" | "unsaved" | "saving" | "error"
 */
export function useAutosave(save, { delay = 1000 } = {}) {
  const [states, setStates] = useState({});
  const saveRef = useRef(save);
  const slots = useRef(new Map());
  const mounted = useRef(true);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const slot = useCallback((key) => {
    if (!slots.current.has(key)) {
      slots.current.set(key, { pending: null, timer: null, controller: null, inFlight: Promise.resolve(), lastError: null });
    }
    return slots.current.get(key);
  }, []);

  const setState = useCallback((key, status, error = "") => {
    setStates((prev) => ({ ...prev, [key]: { status, error } }));
  }, []);

  const flush = useCallback(
    (key) => {
      const current = slot(key);
      clearTimeout(current.timer);
      current.timer = null;
      if (current.pending === null) return current.inFlight;
      const { value } = current.pending;
      current.pending = null;

      current.controller?.abort();
      const ctrl = new AbortController();
      current.controller = ctrl;
      setState(key, "saving");

      const isCurrent = () => mounted.current && slots.current.get(key) === current && current.controller === ctrl;
      const run = current.inFlight
        .catch(() => {})
        .then(() => saveRef.current(key, value, { signal: ctrl.signal }))
        .then(() => {
          if (!isCurrent()) return;
          current.lastError = null;
          setState(key, current.pending === null ? "saved" : "unsaved");
        })
        .catch((err) => {
          if (err?.name === "AbortError" || !isCurrent()) return;
          // Keep it so the next change or flush retries
          if (current.pending === null) current.pending = { value };
          current.lastError = err?.message ?? "Save failed";
          setState(key, "error", current.lastError);
        });
      current.inFlight = run;
      return run;
    },
    [slot, setState]
  );

  const schedule = useCallback(
    (key, value) => {
      const current = slot(key);
      current.pending = { value };
      setState(key, "unsaved");
      clearTimeout(current.timer);
      current.timer = setTimeout(() => flush(key), delay);
    },
    [delay, flush, slot, setState]
  );

  const forget = useCallback((key) => {
    const current = slots.current.get(key);
    if (current) {
      clearTimeout(current.timer);
      current.controller?.abort();
      slots.current.delete(key);
    }
    setStates((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    const allSlots = slots.current;
    // Closing the tab or reloading: warn, and try to save what's pending
    function onBeforeUnload(event) {
      let unsaved = false;
      allSlots.forEach((current, key) => {
        if (current.pending === null) return;
        unsaved = true;
        saveRef.current(key, current.pending.value, { keepalive: true }).catch(() => {});
      });
      if (unsaved) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      mounted.current = false;
      // Navigating away inside the app: save what's pending, don't abort what's in flight
      allSlots.forEach((current, key) => {
        clearTimeout(current.timer);
        if (current.pending !== null) {
          const { value } = current.pending;
          current.pending = null;
          saveRef.current(key, value, { keepalive: true }).catch(() => {});
        }
      });
    };
  }, []);

  const state = useCallback((key) => states[key] ?? SAVED, [states]);
  const pendingError = useCallback((key) => {
    const current = slots.current.get(key);
    return current && current.pending !== null ? current.lastError : null;
  }, []);

  return { state, schedule, flush, forget, pendingError };
}
