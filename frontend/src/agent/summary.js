// What a run did, for the summary at its end: the files it ran (each with its last
// result and how many runs it took) and the files that can't run in the browser.

export function runResults(timeline) {
  const byPath = new Map();
  for (const item of timeline) {
    if (item.type !== "tool" || item.call.name !== "run_file" || !item.result) continue;
    const path = item.call.args.path;
    const previous = byPath.get(path) ?? { path, runs: 0, failures: 0 };
    const status = item.result.status ?? (item.result.error ? "error" : "unknown");
    byPath.set(path, {
      path,
      runs: previous.runs + (status === "unsupported" ? 0 : 1),
      failures: previous.failures + (status !== "ok" && status !== "unsupported" ? 1 : 0),
      status,
      message: item.result.message ?? item.result.error ?? null,
    });
  }
  return [...byPath.values()];
}

export function describeRunResult({ status, runs, failures }) {
  if (status === "unsupported") return "can't run in the browser";
  if (status === "ok") return failures > 0 ? `passed on run ${runs}, after ${failures} failed` : "passed";
  if (status === "timeout") return "timed out (10 s limit)";
  if (status === "output-limit") return "stopped: too much output";
  if (status === "stopped") return "stopped";
  return runs > 1 ? `failed (${runs} runs)` : "failed";
}
