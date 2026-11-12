import { startRun } from "./runController";

// Starting Python takes a second or two even from cache, so a worker that finished
// normally is kept for the next run. Each run still gets fresh globals. A worker that
// was stopped, timed out or crashed is terminated, and the next run starts another.
// Workers that ran agent code have their network turned off for good, so they're
// kept apart from the editor's.
const warm = { online: null, offline: null };

export function forgetPythonWorker() {
  for (const key of Object.keys(warm)) {
    warm[key]?.terminate();
    warm[key] = null;
  }
}

// files: optional [{ path, content }], the project's .py files, so `import` finds
// them. path is this file's project path. Without files, the code runs on its own.
// offline: no network for the code (the agent's runs).
export function runPython({ code, fileName, stdin, onOutput, onProgress, files, path, offline = false }) {
  const slot = offline ? "offline" : "online";
  const existingWorker = warm[slot];
  warm[slot] = null;
  let usedWorker = null;
  const handle = startRun({
    existingWorker,
    // The agent's worker is the same code under a name vercel.json gives a strict CSP
    createWorkers: [
      offline
        ? () => new Worker(new URL("./agentPythonWorker.js", import.meta.url), { type: "module" })
        : () => new Worker(new URL("./pythonWorker.js", import.meta.url), { type: "module" }),
    ],
    send: (worker) => {
      usedWorker = worker;
      worker.postMessage({ code, fileName, stdin, ...(files?.length ? { files, path } : {}), ...(offline ? { offline } : {}) });
    },
    onOutput,
    onProgress,
    keepWorker: (status) => status === "ok" || status === "error",
  });
  handle.result.then(({ status }) => {
    if ((status === "ok" || status === "error") && usedWorker) warm[slot] = usedWorker;
  });
  return handle;
}
