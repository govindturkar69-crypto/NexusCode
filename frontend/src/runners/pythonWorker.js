// Runs Python with Pyodide. Created only when someone first clicks Run on a Python
// file, and it fetches the self-hosted Pyodide files then (see vite.config.js).
// A worker has no DOM and no localStorage, so no way to reach the login token.
import { MAX_OUTPUT_CHARS } from "./runController";
import { describePythonError, exitWasClean } from "./pythonErrors";

/* global __PYODIDE_BASE__, __PYODIDE_DOWNLOAD_BYTES__ */
const BASE = new URL(__PYODIDE_BASE__, self.location.origin).href;
const post = self.postMessage.bind(self);

let sent = 0;
let capped = false;

function emit(stream, text) {
  if (capped || !text) return;
  const room = MAX_OUTPUT_CHARS - sent;
  const piece = text.length > room ? text.slice(0, room) : text;
  sent += piece.length;
  post({ type: "output", stream, text: piece });
  if (text.length >= room) {
    capped = true;
    post({ type: "truncated" });
  }
}

// Downloads the two big files with progress. The browser's cache then serves them to
// Pyodide without a second download, and streams give decoded sizes, so the
// total is exact even when the server compresses them.
async function downloadWithProgress() {
  let received = 0;
  const report = () =>
    post({ type: "progress", stage: "download", received, total: __PYODIDE_DOWNLOAD_BYTES__ });
  report();
  await Promise.all(
    ["pyodide.asm.wasm", "python_stdlib.zip"].map(async (file) => {
      const response = await fetch(BASE + file);
      if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        received += value.length;
        report();
      }
    })
  );
}

async function load() {
  await downloadWithProgress();
  post({ type: "progress", stage: "starting" });
  const { loadPyodide } = await import(/* @vite-ignore */ `${BASE}pyodide.mjs`);
  return loadPyodide({ indexURL: BASE, env: { PYTHONUNBUFFERED: "1" } });
}

function outputSink(stream) {
  const decoder = new TextDecoder();
  return {
    write(bytes) {
      emit(stream, decoder.decode(bytes, { stream: true }));
      return bytes.length;
    },
  };
}

function stdinFrom(text) {
  let remaining = text ?? "";
  return {
    stdin() {
      if (!remaining) return null;
      const all = remaining.endsWith("\n") ? remaining : `${remaining}\n`;
      remaining = "";
      return all;
    },
  };
}

async function run(pyodide, { code, fileName, stdin }) {
  sent = 0;
  capped = false;
  pyodide.setStdout(outputSink("stdout"));
  pyodide.setStderr(outputSink("stderr"));
  pyodide.setStdin(stdinFrom(stdin));
  const globals = pyodide.toPy({ __name__: "__main__", __file__: fileName });
  post({ type: "started" });
  let ok = true;
  try {
    await pyodide.runPythonAsync(code, { globals, filename: fileName });
  } catch (error) {
    if (error.type === "SystemExit") {
      ok = exitWasClean(error.message);
      if (!ok) emit("stderr", `${String(error.message).trim().split("\n").pop()}\n`);
    } else {
      ok = false;
      pyodide.runPython("import sys; sys.stdout.flush(); sys.stderr.flush()");
      emit("stderr", error.type ? describePythonError(error) : `${error}\n`);
    }
  } finally {
    globals.destroy();
  }
  pyodide.runPython("import sys; sys.stdout.flush(); sys.stderr.flush()");
  if (!capped) post({ type: "done", ok });
}

load().then(
  (pyodide) => {
    self.onmessage = ({ data }) => {
      run(pyodide, data).catch((error) => post({ type: "fatal", text: `The code runner failed: ${error.message}\n` }));
    };
    post({ type: "ready" });
  },
  (error) => post({ type: "fatal", text: `Python couldn't be loaded. Check your connection and try again. (${error.message})\n` })
);
