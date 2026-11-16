import { apiFetch, apiFetchAll } from "../api/client";

// What the command palette can find and do. Pure data plus small run()
// functions; CommandPalette.jsx renders and filters it.

const EDIT_ROLES = new Set(["editor", "owner"]);
const canEditRole = (role) => EDIT_ROLES.has(role);

// Tasks and files of a project, fetched once per minute at most while browsing
const cache = new Map();
const TTL_MS = 60_000;

function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = load().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

export function clearPaletteCache() {
  cache.clear();
}

export function loadProjectData(projectId) {
  return Promise.all([
    cached(`tasks:${projectId}`, () => apiFetchAll(`/projects/${projectId}/tasks`, "tasks")),
    cached(`files:${projectId}`, () => apiFetch(`/projects/${projectId}/code/files`).then((d) => d.code_files ?? [])),
  ]).then(([tasks, files]) => ({ tasks, files }));
}

// Scroll to an element that a page renders after loading (e.g. the board's chat)
function scrollWhenReady(id, tries = 40) {
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ block: "start" });
    element.querySelector("textarea, input, [tabindex]")?.focus?.({ preventScroll: true });
  } else if (tries > 0) {
    setTimeout(() => scrollWhenReady(id, tries - 1), 75);
  }
}

const STATUS = { todo: "To do", in_progress: "In progress", done: "Done" };

/**
 * All items, grouped. ctx: { project (current, with role) or null, projects,
 * tasks, files, navigate, toggleTheme, toggleMotion, motionReduced, signOut, exportProject }
 */
export function buildItems(ctx) {
  const { project, projects = [], tasks = [], files = [] } = ctx;
  const items = [];
  const nav = (key, label, to, hint, keywords = "") => items.push({ key, group: "Navigation", kind: "nav", label, hint, keywords, run: () => ctx.navigate(to) });

  if (project) {
    const base = `/projects/${project.id}`;
    nav(`nav:board:${project.id}`, "Board", base, project.name, "kanban tasks");
    nav(`nav:editor:${project.id}`, "Code editor", `${base}/editor`, project.name, "files code monaco");
    items.push({ key: `nav:chat:${project.id}`, group: "Navigation", kind: "nav", label: "Chat", hint: project.name, keywords: "messages talk", run: () => { ctx.navigate(base); scrollWhenReady("chat"); } });
    items.push({ key: `nav:activity:${project.id}`, group: "Navigation", kind: "nav", label: "Activity", hint: project.name, keywords: "feed history log", run: () => { ctx.navigate(base); scrollWhenReady("activity"); } });
    nav(`nav:meeting:${project.id}`, "Video meeting", `${base}/meeting`, project.name, "call video livekit");
    nav(`nav:analytics:${project.id}`, "Analytics", `${base}/analytics`, project.name, "charts burndown throughput stats");
  }
  nav("nav:projects", "Projects", "/projects", "All your projects", "home list");
  nav("nav:dashboard", "Dashboard", "/dashboard", "Totals across projects", "stats");
  nav("nav:ai", "AI Assistant", "/ai", "Generate code, find bugs", "gemini");
  nav("nav:settings", "Settings", "/settings", "Password, email, GitHub, appearance", "preferences account");
  nav("nav:profile", "Profile", "/settings", "Your account", "me user account");

  const act = (key, label, hint, run, keywords = "") => items.push({ key, group: "Actions", kind: "action", label, hint, keywords, run });
  if (project) {
    const base = `/projects/${project.id}`;
    // Editing actions only for those who may edit: viewers never see them
    if (canEditRole(project.role)) {
      act(`act:new-task:${project.id}`, "New task", project.name, () => ctx.navigate(`${base}?do=new-task`), "add create todo");
      act(`act:new-file:${project.id}`, "New file", project.name, () => ctx.navigate(`${base}/editor?do=new-file`), "add create code");
      act(`act:agent:${project.id}`, "Run the AI agent", project.name, () => ctx.navigate(`${base}/editor?do=agent`), "bot ai fix");
    }
    act(`act:meeting:${project.id}`, "Start meeting", project.name, () => ctx.navigate(`${base}/meeting?do=join`), "call join video");
    act(`act:export:${project.id}`, "Export project as ZIP", project.name, () => ctx.exportProject(project.id), "download backup zip");
  }
  act("act:theme", "Toggle theme", "Light or dark · Shift T", () => ctx.toggleTheme(), "dark light mode appearance");
  if (ctx.showShortcuts) act("act:shortcuts", "Keyboard shortcuts", "Every shortcut · ?", () => ctx.showShortcuts(), "keys hotkeys help keyboard");
  act("act:motion", ctx.motionReduced ? "Turn animations back on" : "Reduce motion", "Animations", () => ctx.toggleMotion(), "animation accessibility reduced motion");
  act("act:signout", "Sign out", "End this session", () => ctx.signOut(), "log out logout");

  for (const p of projects) {
    items.push({ key: `project:${p.id}`, group: "Projects", kind: "project", label: p.name, hint: p.role, keywords: "project", run: () => ctx.navigate(`/projects/${p.id}`) });
  }
  if (project) {
    for (const t of tasks) {
      items.push({
        key: `task:${t.id}`,
        group: "Tasks",
        kind: "task",
        label: t.title,
        hint: [STATUS[t.status] ?? t.status, t.assignee_username ? `@${t.assignee_username}` : null].filter(Boolean).join(" · "),
        keywords: "task",
        run: () => ctx.navigate(`/projects/${project.id}?do=task&task=${t.id}`),
      });
    }
    for (const f of files) {
      items.push({ key: `file:${project.id}:${f.id}`, group: "Files", kind: "file", label: f.path, hint: "Open in the editor", keywords: "file code", run: () => ctx.navigate(`/projects/${project.id}/editor?do=open&file=${encodeURIComponent(f.path)}`) });
    }
  }
  return items;
}

export const GROUP_ORDER = ["Recent", "Actions", "Navigation", "Projects", "Tasks", "Files"];
