// Activity feed wording, with no React in it.

const PHRASES = {
  task_created: (target) => `created task "${target}"`,
  task_edited: (target) => `edited task "${target}"`,
  task_moved: (target) => `moved ${target}`,
  task_deleted: (target) => `deleted task "${target}"`,
  file_uploaded: (target) => `uploaded ${target}`,
  member_added: (target) => `added ${target}`,
  member_removed: (target) => `removed ${target}`,
  member_left: () => "left the project",
  role_changed: (target) => `changed a role: ${target}`,
  github_pushed: (target) => `pushed the code to ${target}`,
  code_created: (target) => `created ${target}`,
  code_renamed: (target) => `renamed ${target}`,
  code_deleted: (target) => `deleted ${target}`,
  agent_started: (target) => `started the AI agent: "${target}"`,
  agent_applied: (target) => `accepted AI agent changes: ${target}`,
};

export function describeActivity({ action, target }) {
  const phrase = PHRASES[action];
  return phrase ? phrase(target) : `${action}: ${target}`;
}

// New entries arrive at the front, and "Load more" adds older ones at the back
export function mergeActivity(current, incoming) {
  const seen = new Set();
  return [...current, ...incoming]
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .sort((a, b) => b.id - a.id);
}
