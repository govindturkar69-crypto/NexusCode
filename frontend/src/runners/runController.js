// Runs user code in a Web Worker and enforces the limits from this side, where
// the code can't interfere: a hard timeout that terminates the worker, and an
// output cap. Knows nothing about languages. A worker sends:
//   { type: "ready" }                     loaded, so the code can be sent
//   { type: "started" }                   the code is now running; the timeout starts
//   { type: "progress", ... }             passed to onProgress (first-time downloads)
//   { type: "output", stream, text }      stream is "stdout" or "stderr"
//   { type: "truncated" }                 it stopped sending because of its own cap
//   { type: "done", ok }                  finished
//   { type: "fatal", text }               the runner itself is broken, so don't reuse it

export const RUN_TIMEOUT_MS = 10_000;
export const MAX_OUTPUT_CHARS = 100_000;
const OUTPUT_FLUSH_MS = 50;

// Adjacent text from one stream becomes one chunk, so a chatty program doesn't
// mean thousands of elements on screen. Returns false once the cap is reached.
export function appendOutput(chunks, stream, text, usedChars, maxChars) {
  const room = maxChars - usedChars;
  const piece = text.length > room ? text.slice(0, room) : text;
  if (piece) {
    const last = chunks[chunks.length - 1];
    if (last && last.stream === stream) last.text += piece;
    else chunks.push({ stream, text: piece });
  }
  return { used: usedChars + piece.length, full: text.length >= room };
}

/**
 * Starts a run. Returns { result, stop }, where result is a promise of
 * { status, output, durationMs }. It never rejects. status is one of:
 * ok, error (the code failed), timeout, output-limit, stopped, crashed.
 *
 * createWorkers: functions tried in order until one reports "ready".
 * send(worker): posts the code once the worker is ready.
 * keepWorker(status): return true to leave the worker alive after finishing.
 */
export function startRun({
  createWorkers,
  send,
  onOutput = () => {},
  onProgress = () => {},
  onWorkerLost = () => {},
  keepWorker = () => false,
  existingWorker = null,
  timeoutMs = RUN_TIMEOUT_MS,
  maxOutputChars = MAX_OUTPUT_CHARS,
}) {
  const output = [];
  let used = 0;
  let worker = null;
  let ready = false;
  let finished = false;
  let startedAt = null;
  let timeoutTimer = null;
  let flushTimer = null;
  let nextFactory = 0;
  let resolveResult;
  const result = new Promise((resolve) => {
    resolveResult = resolve;
  });

  const snapshot = () => output.map((chunk) => ({ ...chunk }));

  function flushSoon() {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (!finished) onOutput(snapshot());
    }, OUTPUT_FLUSH_MS);
  }

  function finish(status) {
    if (finished) return;
    finished = true;
    clearTimeout(timeoutTimer);
    clearTimeout(flushTimer);
    const durationMs = startedAt === null ? 0 : Math.max(0, performance.now() - startedAt);
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      if (!keepWorker(status)) {
        worker.terminate();
        onWorkerLost();
      }
    }
    onOutput(snapshot());
    resolveResult({ status, output: snapshot(), durationMs });
  }

  function startClock() {
    if (startedAt !== null) return;
    startedAt = performance.now();
    timeoutTimer = setTimeout(() => finish("timeout"), timeoutMs);
  }

  function handle({ data }) {
    if (finished || !data) return;
    switch (data.type) {
      case "ready":
        if (!ready) {
          ready = true;
          send(worker);
        }
        break;
      case "started":
        startClock();
        break;
      case "progress":
        onProgress(data);
        break;
      case "output": {
        if (typeof data.text !== "string") return;
        const stream = data.stream === "stderr" ? "stderr" : "stdout";
        const { used: nowUsed, full } = appendOutput(output, stream, data.text, used, maxOutputChars);
        used = nowUsed;
        if (full) finish("output-limit");
        else flushSoon();
        break;
      }
      case "truncated":
        finish("output-limit");
        break;
      case "done":
        finish(data.ok ? "ok" : "error");
        break;
      case "fatal":
        appendOutput(output, "stderr", String(data.text ?? ""), used, maxOutputChars);
        finish("crashed");
        break;
      default:
    }
  }

  function tryNextWorker(reason) {
    if (finished) return;
    if (worker) worker.terminate();
    worker = null;
    if (nextFactory >= createWorkers.length) {
      appendOutput(output, "stderr", reason, used, maxOutputChars);
      finish("crashed");
      return;
    }
    try {
      worker = createWorkers[nextFactory++]();
    } catch {
      tryNextWorker("This browser wouldn't start the code runner.");
      return;
    }
    worker.onmessage = handle;
    worker.onerror = (event) => {
      event.preventDefault?.();
      if (!ready) {
        tryNextWorker("This browser wouldn't start the code runner.");
        return;
      }
      appendOutput(output, "stderr", event.message || "The code runner stopped unexpectedly.", used, maxOutputChars);
      finish("crashed");
    };
  }

  if (existingWorker) {
    worker = existingWorker;
    ready = true;
    worker.onmessage = handle;
    worker.onerror = (event) => {
      event.preventDefault?.();
      appendOutput(output, "stderr", event.message || "The code runner stopped unexpectedly.", used, maxOutputChars);
      finish("crashed");
    };
    send(worker);
    // A kept worker might have died, so don't wait for it to say it has started
    startClock();
  } else {
    tryNextWorker("This browser wouldn't start the code runner.");
  }

  return { result, stop: () => finish("stopped") };
}
