// The welcome tour's steps and progress, with no React in it. Progress is kept
// per username on this device; with storage blocked the tour still works for
// the visit, it just isn't remembered.

export const STEPS = [
  { id: "project", title: "Create a project", text: "A project gives you a board, chat, files, a shared code editor and meetings." },
  { id: "invite", title: "Invite a teammate", text: "Add people by username as editors or viewers.", needsProject: true },
  { id: "editor", title: "Open the code editor", text: "Write code together in real time, and run Python, JavaScript or HTML in the browser.", needsProject: true },
  { id: "palette", title: "Try the command palette", text: "Jump to any page, task or file, or run an action, from the keyboard." },
  { id: "meeting", title: "Start a meeting", text: "Video, audio and screen sharing with your project's members.", needsProject: true },
];

const key = (username) => `tour:${username ?? ""}`;

export function readTour(username) {
  try {
    const value = JSON.parse(localStorage.getItem(key(username)) ?? "null");
    if (value && typeof value === "object") {
      return { done: Array.isArray(value.done) ? value.done.filter((id) => STEPS.some((s) => s.id === id)) : [], dismissed: value.dismissed === true };
    }
  } catch {
    // Junk or blocked storage: start fresh
  }
  return { done: [], dismissed: false };
}

export function writeTour(username, state) {
  try {
    localStorage.setItem(key(username), JSON.stringify(state));
  } catch {
    // Blocked: the tour lasts for this visit only
  }
}

export function markDone(state, id) {
  return state.done.includes(id) ? state : { ...state, done: [...state.done, id] };
}

export function isComplete(state) {
  return STEPS.every((step) => state.done.includes(step.id));
}

// Shown on its own to people with no projects yet who haven't closed it;
// anyone can open it again from the account menu or the palette
export function shouldOfferTour(state, projectCount) {
  return !state.dismissed && !isComplete(state) && projectCount === 0;
}

// Steps that finish themselves: having a project, opening the editor or a meeting
export function stepsDoneByVisiting(pathname, projectCount) {
  const done = [];
  if (projectCount > 0) done.push("project");
  if (/^\/projects\/\d+\/editor/.test(pathname)) done.push("editor");
  if (/^\/projects\/\d+\/meeting/.test(pathname)) done.push("meeting");
  return done;
}
