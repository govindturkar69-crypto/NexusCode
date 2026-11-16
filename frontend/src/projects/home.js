// The dashboard's "what's next" data, with no React in it.
import { isOverdue, localToday } from "./tasks";

const RECENT_KEY = (username) => `recent-projects:${username ?? ""}`;
const RECENT_MAX = 8;

// Projects this person opened lately, most recent first (ids, kept on this device)
export function recentProjectIds(username) {
  try {
    const ids = JSON.parse(localStorage.getItem(RECENT_KEY(username)) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id) => Number.isInteger(id)).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberProject(username, projectId) {
  if (!Number.isInteger(projectId)) return;
  try {
    const ids = [projectId, ...recentProjectIds(username).filter((id) => id !== projectId)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY(username), JSON.stringify(ids));
  } catch {
    // Storage blocked: the dashboard falls back to the newest projects
  }
}

// Recently opened projects first, then the newest of the rest
export function orderProjects(projects, recentIds) {
  const rank = new Map(recentIds.map((id, i) => [id, i]));
  return [...projects].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : Infinity;
    const rb = rank.has(b.id) ? rank.get(b.id) : Infinity;
    if (ra !== rb) return ra - rb;
    return String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) || b.id - a.id;
  });
}

const PRIORITY = { high: 0, medium: 1, low: 2 };

// Open tasks assigned to this user: overdue first, then by due date (none last), then priority
export function myOpenTasks(tasksByProject, userId, today = localToday()) {
  const mine = [];
  for (const { project, tasks } of tasksByProject) {
    for (const task of tasks) {
      if (task.assignee_id === userId && task.status !== "done") mine.push({ ...task, project });
    }
  }
  return mine.sort((a, b) => {
    const oa = isOverdue(a, today) ? 0 : 1;
    const ob = isOverdue(b, today) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    if ((a.due_date ?? "~") !== (b.due_date ?? "~")) return (a.due_date ?? "~") < (b.due_date ?? "~") ? -1 : 1;
    return (PRIORITY[a.priority] ?? 1) - (PRIORITY[b.priority] ?? 1);
  });
}

// Activity from several projects as one feed, newest first
export function combinedActivity(activityByProject, limit = 8) {
  return activityByProject
    .flatMap(({ project, activity }) => activity.map((entry) => ({ ...entry, project })))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id)
    .slice(0, limit);
}

// "Good morning" etc. by the local hour
export function greeting(hour = new Date().getHours()) {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
