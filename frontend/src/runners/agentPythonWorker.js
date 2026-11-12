// The Python worker for the agent's runs: the same runner as the editor's, built
// under its own name so that vercel.json can give this file a strict
// Content-Security-Policy. A worker's policy comes from its own response headers.
// blockNetwork() can't stub dynamic import(), which is syntax and reachable from
// Python through js.eval, so the policy is what stops import("https://...").
import "./pythonWorker.js";
