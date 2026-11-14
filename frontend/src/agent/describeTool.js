// One line of the agent timeline for a tool call and, once it's back, its result

function lines(text) {
  return text ? text.split("\n").length : 0;
}

export function describeTool(call, result) {
  const { name, args } = call;
  if (name === "list_files") return { text: "Listed the project files", detail: result?.files ? `${result.files.length} files` : null };
  if (name === "read_file") return { text: `Read ${args.path}`, detail: result?.content !== undefined ? `${lines(result.content)} lines` : null };
  if (name === "write_file") {
    const verb = result?.state === "saved" ? "Saved" : "Proposed a change to";
    return { text: `${result ? verb : "Writing"} ${args.path}`, detail: `${lines(args.content)} lines` };
  }
  if (name === "run_file") {
    if (!result) return { text: `Running ${args.path}...` };
    if (result.status === "unsupported") return { text: `Couldn't run ${args.path}`, detail: result.message };
    const ms = result.duration_ms;
    const seconds = ms === undefined ? "" : ms < 1000 ? ` in ${ms} ms` : ` in ${(ms / 1000).toFixed(1)} s`;
    const ok = result.status === "ok";
    return { text: `Ran ${args.path}: ${ok ? "passed" : result.status}${seconds}`, ok };
  }
  if (name === "add_task") return { text: `${result?.state === "added" ? "Added" : "Proposed"} task "${args.title}"` };
  return { text: name };
}
