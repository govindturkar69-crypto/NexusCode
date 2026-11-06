// The source of the JavaScript worker. It's loaded from a data: URL, which gives
// the worker an opaque origin: no IndexedDB, cookies or same-origin requests, on
// top of what every worker lacks (the page's DOM and localStorage, where the
// login token lives). That's why this is a self-contained function, not a module.

export function workerMain(maxChars) {
  const post = self.postMessage.bind(self);
  // User code can't pretend to be the runner
  self.postMessage = undefined;

  let sent = 0;
  let capped = false;
  let failed = false;

  function emit(stream, text) {
    if (capped) return;
    const room = maxChars - sent;
    const piece = text.length > room ? text.slice(0, room) : text;
    sent += piece.length;
    post({ type: "output", stream, text: piece });
    if (text.length >= room) {
      capped = true;
      post({ type: "truncated" });
    }
  }

  function show(value, seen, depth) {
    if (typeof value === "string") return depth === 0 ? value : JSON.stringify(value);
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "function") return `[Function: ${value.name || "anonymous"}]`;
    if (typeof value === "symbol" || typeof value === "bigint") return value.toString() + (typeof value === "bigint" ? "n" : "");
    if (typeof value !== "object") return String(value);
    if (value instanceof Error) return value.stack || String(value);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return String(value);
    if (seen.includes(value)) return "[Circular]";
    if (depth >= 4) return Array.isArray(value) ? "[Array]" : "[Object]";
    const next = [...seen, value];
    if (Array.isArray(value)) return `[ ${value.map((item) => show(item, next, depth + 1)).join(", ")} ]`;
    if (value instanceof Map) return `Map(${value.size}) { ${[...value].map(([k, v]) => `${show(k, next, depth + 1)} => ${show(v, next, depth + 1)}`).join(", ")} }`;
    if (value instanceof Set) return `Set(${value.size}) { ${[...value].map((item) => show(item, next, depth + 1)).join(", ")} }`;
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    return `{ ${keys.map((key) => `${key}: ${show(value[key], next, depth + 1)}`).join(", ")} }`;
  }

  function format(args) {
    return `${Array.from(args, (arg) => show(arg, [], 0)).join(" ")}\n`;
  }

  let indent = "";
  const write = (stream) => (...args) => {
    const text = format(args);
    emit(stream, indent ? text.split("\n").map((line) => (line ? indent + line : line)).join("\n") : text);
  };
  const out = write("stdout");
  const err = write("stderr");
  const counts = new Map();
  const timers = new Map();
  self.console = {
    log: out,
    info: out,
    debug: out,
    warn: err,
    error: err,
    trace: (...args) => err("Trace:", ...args),
    dir: (value) => out(value),
    table: (value) => out(value),
    assert: (condition, ...args) => {
      if (!condition) err("Assertion failed:", ...args);
    },
    count: (label = "default") => {
      counts.set(label, (counts.get(label) ?? 0) + 1);
      out(`${label}: ${counts.get(label)}`);
    },
    countReset: (label = "default") => counts.delete(label),
    time: (label = "default") => timers.set(label, performance.now()),
    timeEnd: (label = "default") => {
      if (timers.has(label)) out(`${label}: ${(performance.now() - timers.get(label)).toFixed(1)}ms`);
      timers.delete(label);
    },
    group: (...args) => {
      if (args.length > 0) out(...args);
      indent += "  ";
    },
    groupEnd: () => {
      indent = indent.slice(2);
    },
    clear: () => {},
  };

  // The run is over once the code has returned and nothing it scheduled is left.
  // A timer that never stops runs into the timeout, as it should.
  const pending = new Set();
  let codeFinished = false;
  let reportedDone = false;

  function finishIfIdle() {
    if (!codeFinished || pending.size > 0 || reportedDone) return;
    reportedDone = true;
    post({ type: "done", ok: !failed });
  }

  const realSetTimeout = self.setTimeout.bind(self);
  const realClearTimeout = self.clearTimeout.bind(self);
  const realSetInterval = self.setInterval.bind(self);
  const realClearInterval = self.clearInterval.bind(self);

  self.setTimeout = (callback, delay, ...args) => {
    const id = realSetTimeout(() => {
      try {
        if (typeof callback === "function") callback(...args);
      } finally {
        pending.delete(id);
        // Later, so anything this callback's promises schedule is counted first
        realSetTimeout(finishIfIdle, 0);
      }
    }, delay);
    pending.add(id);
    return id;
  };
  self.clearTimeout = (id) => {
    realClearTimeout(id);
    pending.delete(id);
    realSetTimeout(finishIfIdle, 0);
  };
  self.setInterval = (callback, delay, ...args) => {
    const id = realSetInterval(callback, delay, ...args);
    pending.add(id);
    return id;
  };
  self.clearInterval = (id) => {
    realClearInterval(id);
    pending.delete(id);
    realSetTimeout(finishIfIdle, 0);
  };
  if (typeof self.fetch === "function") {
    const realFetch = self.fetch.bind(self);
    let fetches = 0;
    self.fetch = (...args) => {
      const marker = `fetch${fetches++}`;
      pending.add(marker);
      return realFetch(...args).finally(() => {
        pending.delete(marker);
        realSetTimeout(finishIfIdle, 0);
      });
    };
  }

  // The code is wrapped in a function, which adds two lines before it
  const WRAPPER_LINES = 2;

  function describeError(error, fileName) {
    if (!(error instanceof Error)) return `Uncaught ${show(error, [], 1)}\n`;
    const heading = `${error.name}: ${error.message}`;
    const frames = String(error.stack ?? "")
      .split("\n")
      .filter((line) => line.includes(fileName))
      .map((line) =>
        line.replace(new RegExp(`${fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+):(\\d+)`), (_match, row, column) => `${fileName}:${Number(row) - WRAPPER_LINES}:${column}`)
      );
    return `${[heading, ...frames].join("\n")}\n`;
  }

  let currentFile = "script.js";
  function reportFailure(error) {
    failed = true;
    emit("stderr", describeError(error, currentFile));
  }

  self.addEventListener("error", (event) => {
    event.preventDefault();
    reportFailure(event.error ?? new Error(event.message));
  });
  self.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    reportFailure(event.reason);
    realSetTimeout(finishIfIdle, 0);
  });

  self.onmessage = async ({ data }) => {
    self.onmessage = null;
    currentFile = String(data.fileName || "script.js").replace(/[^\w./-]/g, "_");
    post({ type: "started" });
    try {
      const AsyncFunction = (async () => {}).constructor;
      const run = new AsyncFunction(`${data.code}\n//# sourceURL=${currentFile}`);
      await run();
    } catch (error) {
      if (error instanceof SyntaxError && /import|export/.test(error.message)) {
        failed = true;
        emit("stderr", `${error.name}: ${error.message}\nimport and export aren't available here, because each file runs on its own.\n`);
      } else {
        reportFailure(error);
      }
    }
    codeFinished = true;
    realSetTimeout(finishIfIdle, 0);
  };

  post({ type: "ready" });
}

export function workerSource(maxChars) {
  return `(${workerMain.toString()})(${Number(maxChars)});`;
}
