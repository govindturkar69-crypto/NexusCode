// Turns Pyodide's errors into what a Python programmer expects to see. No Pyodide
// or worker in here, so it can be tested on its own.

const NO_MODULE = /No module named ['"]?([\w.]+)['"]?/;
const NOT_INSTALLED = /The module ['"]?([\w.]+)['"]? is included in the Pyodide distribution/;

// Pyodide's own frames say nothing about the user's code
function isInternalFrame(line) {
  return /File "(\/lib\/python|.*_pyodide\/)/.test(line);
}

export function cleanTraceback(traceback) {
  const lines = traceback.split("\n");
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (isInternalFrame(lines[i])) {
      // A frame is its File line plus the indented source lines under it
      while (i + 1 < lines.length && /^ {4,}/.test(lines[i + 1])) i += 1;
    } else {
      kept.push(lines[i]);
    }
  }
  const header = "Traceback (most recent call last):";
  const onlyHeader = kept.length > 0 && kept[0] === header && !kept.slice(1).some((line) => /^ {2}File /.test(line));
  return (onlyHeader ? kept.slice(1) : kept).join("\n").trimEnd();
}

export function moduleNotAvailable(name) {
  return (
    `The module '${name}' isn't available here. The browser runner has Python's standard ` +
    "library, but no third-party packages, and it can't install any."
  );
}

// Text to show for a Python exception, as { type, message } from Pyodide
export function describePythonError({ type, message }) {
  const text = cleanTraceback(String(message ?? ""));
  if (type === "ModuleNotFoundError" || type === "ImportError") {
    const match = text.match(NOT_INSTALLED) ?? text.match(NO_MODULE);
    if (match) {
      const frames = text.split("\n").filter((line) => !NOT_INSTALLED.test(line) && !/^(You can install|See https)/.test(line) && !/^\s*await (micropip|pyodide)\./.test(line) && !/^ModuleNotFoundError/.test(line));
      return `${[...frames, `${type}: ${moduleNotAvailable(match[1])}`].join("\n")}\n`;
    }
  }
  if (type === "EOFError") {
    return `${text}\nThis program called input() but ran out of text. Add what it should read to the Input box.\n`;
  }
  return `${text}\n`;
}

// sys.exit() is how a program ends normally, so only a non-zero code counts as failing
export function exitWasClean(message) {
  const last = String(message ?? "").trim().split("\n").pop();
  const value = last.replace(/^SystemExit:?\s*/, "").trim();
  return value === "" || value === "0" || value === "None";
}
