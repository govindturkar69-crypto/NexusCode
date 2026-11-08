// Hosts the JavaScript runner for the agent's runs. This file is same-origin, so
// vercel.json can give it a strict Content-Security-Policy. The code itself runs
// one level down, in a worker this one creates from a data: URL, as the editor's
// runs do. That inner worker keeps its opaque origin and inherits this worker's
// policy, which is what stops dynamic import("https://..."): blockNetwork() can't
// stub it, because it's syntax. This worker only relays messages.
import { MAX_OUTPUT_CHARS } from "./runController";
import { workerSource } from "./jsWorker";

const post = self.postMessage.bind(self);
const source = workerSource(MAX_OUTPUT_CHARS);

// As in runJavaScript: a data: URL first, a blob: URL if the browser refuses it
const factories = [
  () => new Worker(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`),
  () => {
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
  },
];

let inner = null;
let ready = false;

function start(next) {
  inner?.terminate();
  if (next >= factories.length) {
    post({ type: "fatal", text: "This browser wouldn't start the code runner.\n" });
    return;
  }
  try {
    inner = factories[next]();
  } catch {
    start(next + 1);
    return;
  }
  inner.onmessage = ({ data }) => {
    if (data?.type === "ready") ready = true;
    post(data);
  };
  inner.onerror = (event) => {
    event.preventDefault();
    if (!ready) start(next + 1);
    else post({ type: "fatal", text: `${event.message || "The code runner stopped unexpectedly."}\n` });
  };
}

self.onmessage = ({ data }) => inner?.postMessage(data);
start(0);
