// Runs Python with Pyodide. Created only when someone first clicks Run on a Python
// file, and it fetches the self-hosted Pyodide files then (see vite.config.js).
// A worker has no DOM and no localStorage, so no way to reach the login token.
import { MAX_OUTPUT_CHARS } from "./runController";
import { describePythonError, exitWasClean } from "./pythonErrors";

/* global __PYODIDE_BASE__, __PYODIDE_DOWNLOAD_BYTES__ */
const BASE = new URL(__PYODIDE_BASE__, self.location.origin).href;
const post = self.postMessage.bind(self);

// sys.exit() also rejects Pyodide's internal task. run() has already dealt with it,
// so this only keeps the browser console from reporting it as uncaught.
self.addEventListener("unhandledrejection", (event) => event.preventDefault());

let sent = 0;
let capped = false;

// Project files for a run live here, in Pyodide's in-memory filesystem. Nothing
// leaves the worker, and the folder is emptied before every run.
const PROJECT_DIR = "/home/pyodide/project";

function emit(stream, rawText) {
  // Tracebacks name files by their project path, not the folder they run in
  const text = rawText?.replaceAll(`${PROJECT_DIR}/`, "");
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

// Puts the run's project files in place and makes them importable, like running the
// file from the project's root folder. Modules from an earlier run are forgotten,
// so an import always sees this run's version of a file.
function prepareProject(pyodide, files, mainPath) {
  const setup = pyodide.toPy({ root: PROJECT_DIR });
  try {
    pyodide.runPython(
      `
import importlib, os, shutil, sys
for _name, _module in list(sys.modules.items()):
    if (getattr(_module, "__file__", None) or "").startswith(root + "/"):
        del sys.modules[_name]
sys.path[:] = [p for p in sys.path if p != root and not p.startswith(root + "/")]
shutil.rmtree(root, ignore_errors=True)
os.makedirs(root, exist_ok=True)
os.chdir(root)
importlib.invalidate_caches()
`,
      { globals: setup }
    );
  } finally {
    setup.destroy();
  }
  if (!files || files.length === 0) return null;
  for (const file of files) {
    const fullPath = `${PROJECT_DIR}/${file.path}`;
    pyodide.FS.mkdirTree(fullPath.slice(0, fullPath.lastIndexOf("/")));
    pyodide.FS.writeFile(fullPath, file.content);
  }
  const mainFull = `${PROJECT_DIR}/${mainPath}`;
  const paths = pyodide.toPy({ root: PROJECT_DIR, main_dir: mainFull.slice(0, mainFull.lastIndexOf("/")) });
  try {
    // The script's own folder first, as `python path/to/file.py` does, then the project root
    pyodide.runPython(
      `
import sys
for _p in (root, main_dir):
    sys.path.insert(0, _p)
`,
      { globals: paths }
    );
  } finally {
    paths.destroy();
  }
  return mainFull;
}

async function run(pyodide, { code, fileName, stdin, files, path }) {
  sent = 0;
  capped = false;
  pyodide.setStdout(outputSink("stdout"));
  pyodide.setStderr(outputSink("stderr"));
  pyodide.setStdin(stdinFrom(stdin));
  const mainFull = prepareProject(pyodide, files, path);
  const runName = mainFull ?? fileName;
  // A real __main__ module, fresh for each run. Code that looks itself up through
  // sys.modules["__main__"] needs it: unittest.main() finds the tests that way.
  const scope = pyodide.toPy({ run_name: runName });
  const globals = pyodide.runPython(
    `
import sys, types
saved_main = sys.modules.get("__main__")
module = types.ModuleType("__main__")
module.__file__ = run_name
sys.modules["__main__"] = module
module.__dict__
`,
    { globals: scope }
  );
  post({ type: "started" });
  let ok = true;
  try {
    await pyodide.runPythonAsync(code, { globals, filename: runName });
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
    pyodide.runPython('import sys\nif saved_main is not None:\n    sys.modules["__main__"] = saved_main', { globals: scope });
    scope.destroy();
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
