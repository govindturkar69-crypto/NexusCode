import { runnerFor } from "../runners/runnerFor";

// The agent's tools, run in this browser. The server has already checked each
// call's shape and path; these turn a call into a result the server will accept.
//
// env, supplied by the Agent panel:
//   listPaths()                   -> [{ path, size? }]  the project as the agent sees it
//   read(path)                    -> string | null      null if there's no such file
//   write(path, content)          -> "staged" | "saved"
//   run(path, code, kind, stdin)  -> { status, output: [{ stream, text }], durationMs }
//   proposeTask(task)             -> "proposed" | "added"

// Matches the server's limits, so results aren't refused for size
export const MAX_READ_CHARS = 30_000;
export const MAX_STREAM_CHARS = 20_000;

export const AGENT_CANT_RUN = {
  preview: "Web pages can't be run by the agent. The user can open them with Preview.",
  other: "This file type can't run in the browser. The agent can run Python (.py) and JavaScript (.js) files.",
};

export function splitOutput(output) {
  let stdout = "";
  let stderr = "";
  for (const chunk of output ?? []) {
    if (chunk.stream === "stderr") stderr += chunk.text;
    else stdout += chunk.text;
  }
  return { stdout, stderr };
}

function clip(text, limit) {
  if (text.length <= limit) return text;
  const head = Math.floor(limit / 3);
  return `${text.slice(0, head)}\n... [${text.length - limit} characters cut] ...\n${text.slice(text.length - (limit - head))}`;
}

export function createAgentTools(env) {
  async function readOrFail(path) {
    const content = await env.read(path);
    if (content === null || content === undefined) throw new Error(`No such file: ${path}`);
    return content;
  }

  const handlers = {
    async list_files() {
      const files = await env.listPaths();
      return { files: files.map(({ path, size }) => (Number.isInteger(size) ? { path, size } : { path })) };
    },
    async read_file({ path }) {
      const content = await readOrFail(path);
      return { content: content.length > MAX_READ_CHARS ? content.slice(0, MAX_READ_CHARS) : content };
    },
    async write_file({ path, content }) {
      return { state: await env.write(path, content) };
    },
    async run_file({ path, stdin = "" }) {
      const kind = runnerFor(path);
      if (kind !== "python" && kind !== "javascript") {
        return { status: "unsupported", message: kind === "preview" ? AGENT_CANT_RUN.preview : AGENT_CANT_RUN.other };
      }
      const code = await readOrFail(path);
      const { status, output, durationMs } = await env.run(path, code, kind, stdin);
      const { stdout, stderr } = splitOutput(output);
      return { status, stdout: clip(stdout, MAX_STREAM_CHARS), stderr: clip(stderr, MAX_STREAM_CHARS), duration_ms: Math.round(durationMs ?? 0) };
    },
    async add_task(task) {
      return { state: await env.proposeTask(task) };
    },
  };

  return {
    async execute(call) {
      const handler = handlers[call.name];
      if (!handler) return { error: `Unknown tool ${call.name}` };
      return handler(call.args ?? {});
    },
  };
}
