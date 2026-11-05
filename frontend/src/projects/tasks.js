// Board helpers with no React in them, so they are easy to test.

// Today's date as YYYY-MM-DD in the user's own timezone (due dates have no time)
export function localToday(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isOverdue(task, today = localToday()) {
  return Boolean(task.due_date) && task.status !== "done" && task.due_date < today;
}

// The list as it will look after dropping a task at `index` in a column. The
// list holds all columns mixed; each column keeps its own relative order.
export function moveTask(tasks, taskId, status, index) {
  const moving = tasks.find((t) => t.id === taskId);
  if (!moving) return tasks;
  const rest = tasks.filter((t) => t.id !== taskId);
  const column = rest.filter((t) => t.status === status);
  const updated = { ...moving, status };
  if (index >= column.length) return [...rest, updated];
  const before = rest.indexOf(column[index]);
  return [...rest.slice(0, before), updated, ...rest.slice(before)];
}

export function filterByAssignee(tasks, filter) {
  if (filter === "") return tasks;
  if (filter === "unassigned") return tasks.filter((t) => t.assignee_id == null);
  return tasks.filter((t) => String(t.assignee_id) === filter);
}
