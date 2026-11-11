// Who else is in a file, from a session's awareness, and the CSS that gives their
// cursors (drawn by y-monaco as yRemoteSelection-<clientID> and
// yRemoteSelectionHead-<clientID>) their colour and name.

const COLOR = /^#[0-9a-fA-F]{6}$/;

export function safeColor(color) {
  return typeof color === "string" && COLOR.test(color) ? color : "#888888";
}

// A CSS string literal. Names are user names (letters, digits, _) and the server
// stamps them, but nothing reaches a stylesheet unescaped.
export function cssString(text) {
  return `"${String(text).replace(/[\\"]/g, "\\$&").replace(/[\n\r\f]/g, " ").replace(/[<>]/g, "")}"`;
}

/**
 * The other people here: [{ clientId, name, color, role }], one per person even if
 * they have several tabs open, sorted by name. You are left out.
 */
export function peopleIn(awareness) {
  if (!awareness) return [];
  const byName = new Map();
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue;
    const user = state?.user;
    if (!user || typeof user.name !== "string" || !user.name) continue;
    if (!byName.has(user.name)) byName.set(user.name, { clientId, name: user.name, color: safeColor(user.color), role: user.role === "viewer" ? "viewer" : "editor" });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Changes when someone arrives, leaves or changes colour or role; not when they move
export function peopleSignature(people) {
  return people.map((p) => `${p.name}:${p.color}:${p.role}`).join("|");
}

/** CSS for every remote client in this awareness (all of their tabs). */
export function cursorStyles(awareness) {
  if (!awareness) return "";
  const rules = [];
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID || !Number.isInteger(clientId)) continue;
    const user = state?.user;
    if (!user?.name) continue;
    const color = safeColor(user.color);
    rules.push(
      `.yRemoteSelection-${clientId} { background-color: ${color}33; }`,
      `.yRemoteSelectionHead-${clientId} { position: absolute; height: 100%; border-left: 2px solid ${color}; box-sizing: border-box; }`,
      `.yRemoteSelectionHead-${clientId}::after { content: ${cssString(user.name)}; position: absolute; top: -1.15em; left: -2px; padding: 0 4px; border-radius: 3px; background: ${color}; color: #fff; font: 11px/1.3 var(--font-sans, sans-serif); white-space: nowrap; pointer-events: none; z-index: 10; }`
    );
  }
  return rules.join("\n");
}

export function describePeople(people) {
  if (people.length === 0) return "";
  const names = people.map((p) => (p.role === "viewer" ? `${p.name} (viewing)` : p.name));
  if (names.length === 1) return `${names[0]} is here`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are here`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are here`;
}
