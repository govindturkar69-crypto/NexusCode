// The agent's proposed changes, and the working copy it sees. Nothing reaches the
// project until the user accepts a change (or turns on auto-accept for the session).
//
// Each write_file becomes an entry { key, path, before, after, status }:
//   before  the file when the change was made (null: the file is new)
//   status  pending | accepted | rejected | undone | conflict | failed
// A second write to a path that's still pending updates that entry. The agent reads
// a path's pending version if there is one, and otherwise the live project, so a
// rejected change is gone for it too.
//
// deps, supplied by the editor:
//   readLive(path)              -> string | null   the editor's text, or the saved file
//   applyFile(path, content)    -> { fileId, created }
//   deleteFile(fileId)
//   createTask(task)
//   onAccepted({ runId, files, tasks }) to record what was kept

let nextKey = 1;

export class ChangeStore {
  constructor(deps) {
    this.deps = deps;
    this.entries = [];
    this.tasks = [];
    this.autoAccept = false;
    this.runId = null;
    this.version = 0;
    this.listeners = new Set();
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  notify() {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  update(entry, changes) {
    Object.assign(entry, changes);
    this.notify();
  }

  latest(path) {
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      if (this.entries[i].path === path) return this.entries[i];
    }
    return null;
  }

  isLatest(entry) {
    return this.latest(entry.path) === entry;
  }

  async read(path) {
    const entry = this.latest(path);
    if (entry && (entry.status === "pending" || entry.status === "conflict")) return entry.after;
    return this.deps.readLive(path);
  }

  // The project as the agent sees it: live files plus files it has proposed
  listPaths(liveFiles) {
    const files = new Map(liveFiles.map((file) => [file.path, { path: file.path }]));
    for (const entry of this.entries) {
      if (!this.isLatest(entry)) continue;
      if (entry.status === "pending" || entry.status === "conflict") files.set(entry.path, { path: entry.path, size: entry.after.length });
    }
    return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  pendingCount() {
    return this.entries.filter((e) => e.status === "pending" || e.status === "conflict").length + this.tasks.filter((t) => t.status === "pending").length;
  }

  async stage(path, content) {
    const latest = this.latest(path);
    let entry;
    if (latest && (latest.status === "pending" || latest.status === "conflict")) {
      this.update(latest, { after: content, status: "pending", error: null });
      entry = latest;
    } else {
      const before = await this.deps.readLive(path);
      entry = { key: nextKey++, runId: this.runId, path, before, after: content, status: "pending", error: null, fileId: null, created: false };
      this.entries.push(entry);
      this.notify();
    }
    if (this.autoAccept) {
      await this.accept(entry);
      return entry.status === "accepted" ? "saved" : "staged";
    }
    return "staged";
  }

  // force: write even though the file changed since the agent saw it
  async accept(entry, { force = false } = {}) {
    if (entry.status !== "pending" && entry.status !== "conflict" && entry.status !== "failed") return;
    const current = await this.deps.readLive(entry.path);
    if (!force && current !== entry.before) {
      this.update(entry, { status: "conflict", error: "This file changed since the agent read it. Overwrite it, or reject the change." });
      return;
    }
    this.update(entry, { status: "applying", error: null });
    try {
      const { fileId, created } = await this.deps.applyFile(entry.path, entry.after);
      // A change made over a file that was then deleted becomes a creation
      this.update(entry, { status: "accepted", fileId, created: created || current === null, before: current });
      this.deps.onAccepted?.({ runId: entry.runId, files: [entry.path], tasks: [] });
    } catch (err) {
      this.update(entry, { status: "failed", error: err.message });
    }
  }

  reject(entry) {
    if (entry.status === "pending" || entry.status === "conflict" || entry.status === "failed") this.update(entry, { status: "rejected", error: null });
  }

  async undo(entry) {
    if (entry.status !== "accepted" || !this.isLatest(entry)) return;
    this.update(entry, { status: "applying", error: null });
    try {
      if (entry.created) await this.deps.deleteFile(entry.fileId);
      else await this.deps.applyFile(entry.path, entry.before);
      this.update(entry, { status: "undone" });
    } catch (err) {
      this.update(entry, { status: "accepted", error: `Couldn't undo: ${err.message}` });
    }
  }

  async acceptAll() {
    for (const entry of [...this.entries]) {
      if (entry.status === "pending" && this.isLatest(entry)) await this.accept(entry);
    }
    for (const task of [...this.tasks]) {
      if (task.status === "pending") await this.acceptTask(task);
    }
  }

  rejectAll() {
    this.entries.forEach((entry) => this.reject(entry));
    this.tasks.forEach((task) => this.rejectTask(task));
  }

  async proposeTask(task) {
    const entry = { key: nextKey++, runId: this.runId, ...task, status: "pending", error: null };
    this.tasks.push(entry);
    this.notify();
    if (this.autoAccept) {
      await this.acceptTask(entry);
      return entry.status === "added" ? "added" : "proposed";
    }
    return "proposed";
  }

  async acceptTask(task) {
    if (task.status !== "pending" && task.status !== "failed") return;
    this.update(task, { status: "adding", error: null });
    try {
      await this.deps.createTask({ title: task.title, description: task.description ?? null, priority: task.priority ?? "medium" });
      this.update(task, { status: "added" });
      this.deps.onAccepted?.({ runId: task.runId, files: [], tasks: [task.title] });
    } catch (err) {
      this.update(task, { status: "failed", error: err.message });
    }
  }

  rejectTask(task) {
    if (task.status === "pending" || task.status === "failed") this.update(task, { status: "rejected" });
  }

  setAutoAccept(value) {
    this.autoAccept = value;
    this.notify();
  }
}
