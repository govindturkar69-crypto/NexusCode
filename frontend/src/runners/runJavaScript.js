import { MAX_OUTPUT_CHARS, startRun } from "./runController";
import { workerSource } from "./jsWorker";

// A data: URL gives the worker an opaque origin. Browsers that refuse one fall back
// to a blob: URL, which keeps the page's origin. Neither can reach the DOM or the
// login token, because workers have no DOM and no localStorage.
function createWorkers() {
  const source = workerSource(MAX_OUTPUT_CHARS);
  return [
    () => new Worker(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`),
    () => {
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      return worker;
    },
  ];
}

// offline: no network for the code (the agent's runs)
export function runJavaScript({ code, fileName, onOutput, offline = false }) {
  return startRun({
    createWorkers: createWorkers(),
    send: (worker) => worker.postMessage(offline ? { code, fileName, offline } : { code, fileName }),
    onOutput,
  });
}
