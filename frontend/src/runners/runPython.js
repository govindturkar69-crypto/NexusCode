import { startRun } from "./runController";

// Starting Python takes a second or two even from cache, so a worker that finished
// normally is kept for the next run. Each run still gets fresh globals. A worker that
// was stopped, timed out or crashed is terminated, and the next run starts another.
let warmWorker = null;

export function forgetPythonWorker() {
  warmWorker?.terminate();
  warmWorker = null;
}

export function runPython({ code, fileName, stdin, onOutput, onProgress }) {
  const existingWorker = warmWorker;
  warmWorker = null;
  let usedWorker = null;
  const handle = startRun({
    existingWorker,
    createWorkers: [() => new Worker(new URL("./pythonWorker.js", import.meta.url), { type: "module" })],
    send: (worker) => {
      usedWorker = worker;
      worker.postMessage({ code, fileName, stdin });
    },
    onOutput,
    onProgress,
    keepWorker: (status) => status === "ok" || status === "error",
  });
  handle.result.then(({ status }) => {
    if ((status === "ok" || status === "error") && usedWorker) warmWorker = usedWorker;
  });
  return handle;
}
