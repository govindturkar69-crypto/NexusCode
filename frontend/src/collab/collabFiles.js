import { createCollabSession } from "./collabSession";
import { cursorStyles, peopleIn, peopleSignature } from "./presence";

/**
 * The live sessions for the files open in the editor: one per open tab, created
 * when the tab opens and closed with it. React reads it through subscribe() and
 * getVersion() (useSyncExternalStore), so a change in any session re-renders.
 *
 * configure({ projectId, username, onText }): onText(fileId, text) runs whenever a
 * file's text changes, from anyone, so the editor's copy stays current.
 */
export class CollabFiles {
  constructor({ create = createCollabSession } = {}) {
    this.create = create;
    this.sessions = new Map();
    this.unsubscribes = new Map();
    this.peopleSignatures = new Map();
    this.config = {};
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

  configure(config) {
    this.config = { ...this.config, ...config };
  }

  // Opens sessions for these file ids and closes the rest
  setOpen(fileIds) {
    const wanted = new Set(fileIds);
    let changed = false;
    for (const [fileId, session] of this.sessions) {
      if (!wanted.has(fileId)) {
        this.unsubscribes.get(fileId)?.();
        this.unsubscribes.delete(fileId);
        session.destroy();
        this.sessions.delete(fileId);
        changed = true;
      }
    }
    for (const fileId of wanted) {
      if (this.sessions.has(fileId) || !this.config.projectId) continue;
      const session = this.create({ projectId: this.config.projectId, fileId, username: this.config.username });
      const offState = session.subscribe(() => this.notify());
      const onText = () => this.config.onText?.(fileId, session.text.toString());
      session.text.observe(onText);
      // Re-render when someone arrives or leaves, not on every cursor move
      const onAwareness = () => {
        const signature = peopleSignature(peopleIn(session.awareness));
        if (signature !== this.peopleSignatures.get(fileId)) {
          this.peopleSignatures.set(fileId, signature);
          this.notify();
        }
      };
      session.awareness.on("change", onAwareness);
      this.unsubscribes.set(fileId, () => {
        offState();
        session.text.unobserve(onText);
        session.awareness.off("change", onAwareness);
        this.peopleSignatures.delete(fileId);
      });
      this.sessions.set(fileId, session);
      changed = true;
    }
    if (changed) this.notify();
  }

  get(fileId) {
    return this.sessions.get(fileId) ?? null;
  }

  stateFor(fileId) {
    return this.sessions.get(fileId)?.getState() ?? null;
  }

  // Live editing works for this file: synced, and not ended by the server
  isLive(fileId) {
    const state = this.stateFor(fileId);
    return Boolean(state?.synced && !state.closed);
  }

  // The other people in a file: [{ clientId, name, color, role }]
  people(fileId) {
    return peopleIn(this.sessions.get(fileId)?.awareness);
  }

  cursorStyles(fileId) {
    return cursorStyles(this.sessions.get(fileId)?.awareness);
  }

  // Some file has edits made offline that haven't reached the server
  hasUnsynced() {
    return [...this.sessions.values()].some((session) => session.getState().unsynced);
  }

  destroyAll() {
    this.setOpen([]);
  }
}
