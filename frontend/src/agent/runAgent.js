import { apiFetch, apiStream, ApiError } from "../api/client";

// Drives one agent run from the browser. The server streams each Gemini step and
// decides what's allowed; this loop runs the tool calls it hands out (through
// `tools.execute`, which never touches the server's database directly) and sends
// the results back, until the server says the run is over.
//
// onEvent receives, in order:
//   { type: "run", run }                         the run was created
//   { type: "step", step }                       a step started (1-based)
//   { type: "thought" | "text", text }           streamed pieces
//   { type: "tool_call", call }                  { id, name, args }, about to run
//   { type: "tool_result", call, result }        what it returned
//   { type: "tool_rejected", call }              { id, name, error }, refused by the server
//   { type: "retry", attempt, detail }           a step failed and is being tried again
//   { type: "end", status, reason, summary, steps, tokens }
//
// It resolves with the end event. It never rejects, except for an error starting
// the run (no permission, quota), which the caller shows as is.

export const MAX_STEP_RETRIES = 2;
const RETRY_DELAY_MS = 3000;
const RATE_LIMIT_DELAY_MS = 15000;

function wait(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function startAgentRun(projectId, goal) {
  return apiFetch(`/ai/projects/${projectId}/agent/runs`, { method: "POST", body: { goal } });
}

export function fetchAgentQuota() {
  return apiFetch("/ai/agent/quota");
}

export function stopAgentRun(runId) {
  return apiFetch(`/ai/agent/runs/${runId}/stop`, { method: "POST" });
}

export function reportAccepted(runId, { files = [], tasks = [] }) {
  return apiFetch(`/ai/agent/runs/${runId}/accepted`, { method: "POST", body: { files, tasks } });
}

// One step. Resolves { calls, done, error } where error is { detail, retryable }.
// announce() is called before anything the model sent, so a step the server ends
// straight away (a cap) never shows up as a step.
async function streamStep(runId, results, { signal, onEvent, announce }) {
  const calls = [];
  let done = null;
  let error = null;
  await apiStream(`/ai/agent/runs/${runId}/step`, {
    body: { results },
    signal,
    onEvent: ({ event, data }) => {
      if (event === "thought" || event === "text") {
        announce();
        onEvent({ type: event, text: data.text });
      } else if (event === "tool_call") {
        announce();
        calls.push(data);
      } else if (event === "tool_rejected") {
        announce();
        onEvent({ type: "tool_rejected", call: data });
      }
      else if (event === "done") done = data;
      else if (event === "error") error = data;
    },
  });
  return { calls, done, error };
}

export async function runAgent({ projectId, goal, tools, onEvent = () => {}, signal, startRun = startAgentRun }) {
  const run = await startRun(projectId, goal);
  onEvent({ type: "run", run });
  const end = (fields) => {
    const event = { type: "end", steps: 0, tokens: 0, ...fields };
    onEvent(event);
    return event;
  };

  let results = [];
  for (let stepNumber = 1; ; stepNumber += 1) {
    if (signal?.aborted) return end({ status: "stopped", reason: "Stopped by you." });
    let announced = false;
    const announce = () => {
      if (announced) return;
      announced = true;
      onEvent({ type: "step", step: stepNumber });
    };

    let outcome;
    for (let attempt = 0; ; attempt += 1) {
      try {
        outcome = await streamStep(run.id, results, { signal, onEvent, announce });
      } catch (err) {
        if (err.name === "AbortError" || signal?.aborted) return end({ status: "stopped", reason: "Stopped by you." });
        // 503 is Gemini busy or out of quota; the server left the step to be asked again
        // A daily limit won't lift by retrying; a per-minute one or a busy server will
        const daily = /quota|allowance/i.test(err.message);
        outcome = { error: { detail: err.message, retryable: err instanceof ApiError && err.status === 503 && !daily } };
      }
      if (!outcome.error) break;
      if (!outcome.error.retryable || attempt >= MAX_STEP_RETRIES) {
        return end({ status: "failed", reason: outcome.error.detail });
      }
      onEvent({ type: "retry", attempt: attempt + 1, detail: outcome.error.detail });
      // Gemini's per-minute limits need longer than a busy blip
      const tooMany = /too many requests/i.test(outcome.error.detail);
      await wait((tooMany ? RATE_LIMIT_DELAY_MS : RETRY_DELAY_MS) * (attempt + 1), signal);
      if (signal?.aborted) return end({ status: "stopped", reason: "Stopped by you." });
    }

    const { calls, done } = outcome;
    if (!done) return end({ status: "failed", reason: "The connection ended before the step finished." });
    if (done.status !== "tool_calls") {
      return end({ status: done.status, reason: done.reason ?? null, summary: done.summary ?? null, steps: done.steps, tokens: done.tokens });
    }

    results = [];
    for (const call of calls) {
      if (signal?.aborted) return end({ status: "stopped", reason: "Stopped by you." });
      onEvent({ type: "tool_call", call });
      let result;
      try {
        result = await tools.execute(call, { signal });
      } catch (err) {
        result = { error: err?.message || "The tool failed." };
      }
      onEvent({ type: "tool_result", call, result });
      results.push({ id: call.id, result });
    }
  }
}
