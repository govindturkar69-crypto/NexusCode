// Turns off network access in a worker, for code the agent runs. Applied before the
// code starts, on the global object and every prototype above it, and made
// non-writable and non-configurable, so the code can't reach or restore the
// originals (Python's `js` module sees the same objects).
//
// Self-contained on purpose: the JavaScript worker is built from this function's
// source text, so it may not use anything from outside it.
export function blockNetwork(scope) {
  const message = "network access is turned off for code the agent runs.";
  const refuse = (name) =>
    function blocked() {
      throw new TypeError(`${name}: ${message}`);
    };
  const replacements = {
    fetch: function fetch() {
      return Promise.reject(new TypeError(`fetch: ${message}`));
    },
    XMLHttpRequest: refuse("XMLHttpRequest"),
    WebSocket: refuse("WebSocket"),
    EventSource: refuse("EventSource"),
    WebTransport: refuse("WebTransport"),
    importScripts: refuse("importScripts"),
    Worker: refuse("Worker"),
    SharedWorker: refuse("SharedWorker"),
  };
  const chain = [];
  for (let target = scope; target; target = Object.getPrototypeOf(target)) chain.push(target);
  for (const [name, value] of Object.entries(replacements)) {
    for (const target of chain) {
      if (target !== scope && !Object.prototype.hasOwnProperty.call(target, name)) continue;
      try {
        Object.defineProperty(target, name, { value, writable: false, configurable: false, enumerable: false });
      } catch {
        // Already locked down, or not something this browser lets us change
      }
    }
  }
}
