import { useCallback, useEffect, useRef, useState } from "react";
import { runJavaScript } from "./runJavaScript";
import { runPython } from "./runPython";

const RUNNERS = { javascript: runJavaScript, python: runPython };
const EMPTY = { output: [], outcome: null };

function baseName(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Runs files one at a time, in this browser, with what's in the editor. Each file
 * keeps its own last output, so switching tabs doesn't lose it or mix it up.
 *
 *   run(file, code, kind, stdin, extra)  starts a run, stopping any earlier one.
 *                                 extra is passed to the runner (Python's project files)
 *   stop()                        ends the current run
 *   clear(fileId)                 forgets a file's output
 *   resultFor(fileId)             { output, outcome }
 *   runningFileId, loading        what's running now, and Python's first-load progress
 */
export function useCodeRunner() {
  const [results, setResults] = useState({});
  const [runningFileId, setRunningFileId] = useState(null);
  const [loading, setLoading] = useState(null);
  const current = useRef(null);

  useEffect(() => () => current.current?.stop(), []);

  const setResult = useCallback((fileId, changes) => {
    setResults((previous) => ({ ...previous, [fileId]: { ...(previous[fileId] ?? EMPTY), ...changes } }));
  }, []);

  const run = useCallback(
    (file, code, kind, stdin = "", extra = {}) => {
      current.current?.stop();
      setResult(file.id, { output: [], outcome: null });
      setLoading(null);
      setRunningFileId(file.id);
      const handle = RUNNERS[kind]({
        code,
        fileName: baseName(file.path),
        stdin,
        ...extra,
        onOutput: (output) => {
          if (current.current !== handle) return;
          setLoading(null);
          setResult(file.id, { output });
        },
        onProgress: (progress) => {
          if (current.current === handle) setLoading(progress);
        },
      });
      current.current = handle;
      handle.result.then(({ status, output, durationMs }) => {
        // A newer run has replaced this one, but its output still belongs to its file
        setResult(file.id, { output, outcome: { status, durationMs } });
        if (current.current !== handle) return;
        current.current = null;
        setRunningFileId(null);
        setLoading(null);
      });
    },
    [setResult]
  );

  const stop = useCallback(() => current.current?.stop(), []);
  const clear = useCallback((fileId) => setResult(fileId, EMPTY), [setResult]);
  const resultFor = useCallback((fileId) => results[fileId] ?? EMPTY, [results]);

  return { run, stop, clear, resultFor, runningFileId, loading };
}
