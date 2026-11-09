import * as decoding from "lib0/decoding";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { wsBase } from "../api/client";
import { ticketedSocketClass } from "./ticketedSocket";

// One collaborative code file: a Yjs document kept in sync with the server over
// /ws/code-files/{id}, plus who else is here (awareness). The editor binds its
// Monaco model to `text` once the first sync has arrived.

export const TEXT_NAME = "content";
export const MESSAGE_SESSION = 100;
export const CLOSE_RESYNC = 4005;

// Close codes from the server that mean "don't try again": reconnecting can't fix them
export const PERMANENT_CLOSES = {
  4001: "You no longer have access to this project.",
  4004: "This file was deleted.",
  4009: "This file is too large to edit together. Your last change couldn't be saved.",
  4013: "You have too many files open for live editing. Close some tabs and reopen this one.",
};

const COLORS = ["#e5534b", "#d97706", "#16a34a", "#0891b2", "#2563eb", "#7c3aed", "#db2777", "#65a30d", "#ea580c", "#0d9488"];

export function colorFor(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/**
 * Opens a file's live document. Returns
 *   { doc, text, awareness, provider, getState(), subscribe(fn), destroy() }
 * where the state is { status, synced, role, username, closed, unsynced }:
 *   status   "connecting" | "connected" | "disconnected"
 *   synced   the first full sync has happened (the text is the server's)
 *   role     "editor" | "viewer", as the server says
 *   closed   { code, message } when the server ended it for good
 *   unsynced edits were made while disconnected and haven't reached the server yet
 *   resync   the server refused changes this copy has: throw it away and open afresh
 */
export function createCollabSession({ projectId, fileId, username, Socket, url = `${wsBase()}/ws/code-files` }) {
  const doc = new Y.Doc();
  const text = doc.getText(TEXT_NAME);
  const provider = new WebsocketProvider(url, String(fileId), doc, {
    WebSocketPolyfill: Socket ?? ticketedSocketClass(projectId),
    // Other tabs go through the server too, which checks their role
    disableBc: true,
    maxBackoffTime: 10000,
  });

  let state = { status: "connecting", synced: false, role: null, username: null, closed: null, unsynced: false };
  const listeners = new Set();
  const set = (changes) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener(state));
  };

  provider.messageHandlers[MESSAGE_SESSION] = (_encoder, decoder) => {
    const session = JSON.parse(decoding.readVarString(decoder));
    set({ role: session.role, username: session.username });
  };
  provider.on("status", ({ status }) => set({ status }));
  provider.on("sync", (synced) => {
    // A sync after reconnecting exchanges everything both sides were missing
    if (synced && (!state.synced || state.unsynced)) set({ synced: true, unsynced: false });
  });
  doc.on("update", (_update, origin) => {
    // The provider applies other people's changes; anything else is typed here
    if (origin !== provider && state.status !== "connected" && !state.unsynced) set({ unsynced: true });
  });
  provider.on("connection-close", (event) => {
    if (event?.code === CLOSE_RESYNC) {
      provider.disconnect();
      set({ resync: true, status: "disconnected" });
      return;
    }
    const fallback = PERMANENT_CLOSES[event?.code];
    if (fallback) {
      provider.disconnect();
      // The server's own reason is more specific (which limit, say), when it gives one
      const message = typeof event.reason === "string" && event.reason ? event.reason : fallback;
      set({ closed: { code: event.code, message }, status: "disconnected" });
    }
  });

  provider.awareness.setLocalStateField("user", { name: username ?? "", color: colorFor(username ?? "") });

  return {
    doc,
    text,
    provider,
    awareness: provider.awareness,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      listeners.clear();
      provider.destroy();
      doc.destroy();
    },
  };
}

// Replaces the document's text with `next`, changing only the part that differs,
// so other people's cursors elsewhere in the file stay where they are.
export function replaceText(ytext, next) {
  const current = ytext.toString();
  if (current === next) return;
  let start = 0;
  while (start < current.length && start < next.length && current[start] === next[start]) start += 1;
  let end = 0;
  while (end < current.length - start && end < next.length - start && current[current.length - 1 - end] === next[next.length - 1 - end]) end += 1;
  ytext.doc.transact(() => {
    ytext.delete(start, current.length - start - end);
    ytext.insert(start, next.slice(start, next.length - end));
  });
}
