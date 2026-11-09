import { apiFetch } from "../api/client";

// A WebSocket that fetches a fresh single-use ticket before every connection.
// y-websocket creates a new socket for each connect and reconnect, using the class
// it's given, so handing it this one means a reconnect never reuses a ticket.
//
// It behaves like a WebSocket as far as y-websocket uses one: readyState and its
// constants, binaryType, the on* handlers, send() and close().

export const CLOSE_NO_ACCESS = 4001;

export function fetchTicket(projectId) {
  return apiFetch("/ws-ticket", { method: "POST", body: { project_id: Number(projectId) } }).then((data) => data.ticket);
}

export function ticketedSocketClass(projectId, { getTicket = fetchTicket, Socket = WebSocket } = {}) {
  return class TicketedSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url, protocols) {
      this.CONNECTING = 0;
      this.OPEN = 1;
      this.CLOSING = 2;
      this.CLOSED = 3;
      this.url = url;
      this.readyState = this.CONNECTING;
      this.binaryType = "arraybuffer";
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      this._socket = null;
      this._closing = false;

      getTicket(projectId).then(
        (ticket) => {
          if (this._closing) return;
          const separator = url.includes("?") ? "&" : "?";
          const socket = new Socket(`${url}${separator}ticket=${encodeURIComponent(ticket)}`, protocols);
          socket.binaryType = this.binaryType;
          this._socket = socket;
          socket.onopen = (event) => {
            this.readyState = this.OPEN;
            this.onopen?.(event);
          };
          socket.onmessage = (event) => this.onmessage?.(event);
          socket.onerror = (event) => this.onerror?.(event);
          socket.onclose = (event) => {
            this.readyState = this.CLOSED;
            this.onclose?.(event);
          };
        },
        (err) => {
          // No ticket (offline, or no longer a member): a failed connection, which
          // y-websocket retries with backoff. A 404 means no access, which it shouldn't.
          if (this._closing) return;
          this.readyState = this.CLOSED;
          this.onclose?.({ code: err?.status === 404 ? CLOSE_NO_ACCESS : 1006, reason: err?.message ?? "", wasClean: false });
        }
      );
    }

    send(data) {
      if (this._socket && this.readyState === this.OPEN) this._socket.send(data);
    }

    close(code, reason) {
      this._closing = true;
      if (this._socket) {
        this.readyState = this.CLOSING;
        this._socket.close(code, reason);
      } else if (this.readyState !== this.CLOSED) {
        this.readyState = this.CLOSED;
        setTimeout(() => this.onclose?.({ code: code ?? 1000, reason: reason ?? "", wasClean: true }), 0);
      }
    }
  };
}
