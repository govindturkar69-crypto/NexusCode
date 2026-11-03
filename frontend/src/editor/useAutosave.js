import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Debounced autosave.
 *
 *   const { status, error, schedule, flush } = useAutosave(save, { delay: 1000 })
 *   schedule(value)  -> saves `delay` ms after the last change
 *   flush()          -> saves now (e.g. after a language switch)
 *
 * save(value, { signal, keepalive }) must return a promise that rejects on
 * failure (apiFetch does). Guarantees:
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
  const [status, setStatus] = useState("saved");
  const [error, setError] = useState("");
  const saveRef = useRef(save);
  const pending = useRef(null); // { value } waiting to be saved, or null
  const timer = useRef(null);
  const controller = useRef(null);
  const inFlight = useRef(Promise.resolve());
  const mounted = useRef(true);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    if (pending.current === null) return inFlight.current;
    const { value } = pending.current;
    pending.current = null;

    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setStatus("saving");

    const run = inFlight.current
      .catch(() => {})
      .then(() => saveRef.current(value, { signal: ctrl.signal }))
      .then(() => {
        if (!mounted.current || controller.current !== ctrl) return;
        setError("");
        setStatus(pending.current === null ? "saved" : "unsaved");
      })
      .catch((err) => {
        if (err?.name === "AbortError" || !mounted.current || controller.current !== ctrl) return;
        // Keep it so the next change or flush retries
        if (pending.current === null) pending.current = { value };
        setError(err?.message ?? "Save failed");
        setStatus("error");
      });
    inFlight.current = run;
    return run;
  }, []);

  const schedule = useCallback(
    (value) => {
      pending.current = { value };
      setStatus("unsaved");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush]
  );

  useEffect(() => {
    mounted.current = true;
    // Closing the tab or reloading: warn, and try to save what's pending
    function onBeforeUnload(event) {
      if (pending.current === null) return;
      saveRef.current(pending.current.value, { keepalive: true }).catch(() => {});
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      mounted.current = false;
      // Navigating away inside the app: save what's pending, don't abort what's in flight
      clearTimeout(timer.current);
      if (pending.current !== null) {
        const { value } = pending.current;
        pending.current = null;
        saveRef.current(value, { keepalive: true }).catch(() => {});
      }
    };
  }, []);

  return { status, error, schedule, flush };
}
