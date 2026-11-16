// Registers the service worker (public/sw.js) in production builds, and offers a
// reload when a new version has been deployed. Loaded after the page has
// loaded, so none of it is in the main bundle or slows the first paint.
//
// The no-stale-code guarantee lives in sw.js (pages always come from the
// network). This file decides when a waiting new worker takes over: only when
// the user clicks "Reload", then the page reloads once onto the new version.

const CHECK_EVERY_MS = 60 * 60 * 1000;

export function canRegister(win = window) {
  return Boolean(win.navigator?.serviceWorker) && win.isSecureContext !== false;
}

// onUpdate(apply): called once a new version is installed and waiting; apply()
// tells it to take over, after which the page reloads (once).
export async function registerServiceWorker({ onUpdate, win = window } = {}) {
  if (!canRegister(win)) return null;
  const sw = win.navigator.serviceWorker;
  // With no controller yet this is the first install: claiming the page then
  // must not reload it
  const hadController = Boolean(sw.controller);
  let reloading = false;
  sw.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    win.location.reload();
  });

  const registration = await sw.register("/sw.js", { scope: "/", updateViaCache: "none" });
  let offered = false;
  const offer = (worker) => {
    if (offered || !worker || !sw.controller) return;
    offered = true;
    onUpdate?.(() => worker.postMessage("SKIP_WAITING"));
  };

  if (registration.waiting) offer(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") offer(worker);
    });
  });

  // Long-lived tabs look for a new deploy now and then, and when they come back
  const check = () => registration.update().catch(() => {});
  win.setInterval(check, CHECK_EVERY_MS);
  win.document.addEventListener("visibilitychange", () => {
    if (win.document.visibilityState === "visible") check();
  });
  return registration;
}

// A small "new version" bar, in plain DOM so it needs nothing from React.
// Reuses the toast styles; focus isn't stolen, and it's announced politely.
export function showUpdatePrompt(apply, doc = document) {
  if (doc.querySelector(".update-prompt")) return;
  const bar = doc.createElement("div");
  bar.className = "update-prompt";
  bar.setAttribute("role", "status");
  const text = doc.createElement("p");
  text.textContent = "A new version of NexusCode is ready.";
  const reload = doc.createElement("button");
  reload.type = "button";
  reload.className = "btn btn--primary btn--sm";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => {
    reload.disabled = true;
    reload.textContent = "Reloading…";
    apply();
  });
  const later = doc.createElement("button");
  later.type = "button";
  later.className = "btn btn--subtle btn--sm";
  later.textContent = "Later";
  later.addEventListener("click", () => bar.remove());
  bar.append(text, reload, later);
  doc.body.append(bar);
}

export function start() {
  return registerServiceWorker({ onUpdate: (apply) => showUpdatePrompt(apply) }).catch(() => null);
}
