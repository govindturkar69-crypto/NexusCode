import { createAgentTools } from "./agentTools";
import { ChangeStore } from "./changeStore";
import { reportAccepted } from "./runAgent";
import { runJavaScript } from "../runners/runJavaScript";
import { collectPythonFiles } from "../runners/pythonProject";
import { runPython } from "../runners/runPython";

const RUNNERS = { python: runPython, javascript: runJavaScript };
const REPORT_DELAY_MS = 1500;

function baseName(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Everything an Agent panel keeps between renders that isn't React state: the
 * change store, the tools, the code run in progress and the batching of
 * "accepted" reports. The panel gives it the editor's functions with setDeps.
 *
 * deps: { readLive, applyFile, deleteFile, createTask, files, runners? }
 */
export class AgentSession {
  constructor() {
    this.deps = { files: [] };
    this.handle = null;
    this.reports = new Map();
    this.reportTimer = null;
    this.store = new ChangeStore({
      readLive: (path) => this.deps.readLive(path),
      applyFile: (path, content) => this.deps.applyFile(path, content),
      deleteFile: (fileId) => this.deps.deleteFile(fileId),
      createTask: (task) => this.deps.createTask(task),
      onAccepted: (kept) => this.queueReport(kept),
    });
    this.tools = createAgentTools({
      listPaths: () => this.store.listPaths(this.deps.files ?? []),
      read: (path) => this.store.read(path),
      write: (path, content) => this.store.stage(path, content),
      run: (path, code, kind, stdin) => this.runCode(path, code, kind, stdin),
      proposeTask: (task) => this.store.proposeTask(task),
    });
  }

  setDeps(deps) {
    this.deps = { ...this.deps, ...deps };
  }

  startRun(runId) {
    this.store.runId = runId;
  }

  async runCode(path, code, kind, stdin) {
    const runner = (this.deps.runners ?? RUNNERS)[kind];
    let extra = {};
    if (kind === "python") {
      // The agent's versions of the other .py files, pending changes included
      const paths = this.store.listPaths(this.deps.files ?? []).map((file) => file.path);
      const files = await collectPythonFiles(paths, (p) => this.store.read(p), path, code);
      if (files.length) extra = { files, path };
    }
    const handle = runner({ code, fileName: baseName(path), stdin, onOutput: () => {}, ...extra });
    this.handle = handle;
    return handle.result.finally(() => {
      if (this.handle === handle) this.handle = null;
    });
  }

  stopCode() {
    this.handle?.stop();
  }

  queueReport({ runId, files, tasks }) {
    if (!runId) return;
    const entry = this.reports.get(runId) ?? { files: new Set(), tasks: [] };
    files.forEach((path) => entry.files.add(path));
    entry.tasks.push(...tasks);
    this.reports.set(runId, entry);
    clearTimeout(this.reportTimer);
    this.reportTimer = setTimeout(() => this.flushReports(), REPORT_DELAY_MS);
  }

  flushReports() {
    clearTimeout(this.reportTimer);
    for (const [runId, kept] of this.reports) {
      reportAccepted(runId, { files: [...kept.files], tasks: kept.tasks }).catch(() => {});
    }
    this.reports.clear();
  }
}
