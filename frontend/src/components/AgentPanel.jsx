import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { AgentSession } from "../agent/agentSession";
import { describeTool } from "../agent/describeTool";
import { fetchAgentQuota, runAgent, stopAgentRun } from "../agent/runAgent";
import { AI_NOT_CONFIGURED_TEXT, aiErrorText } from "../api/aiErrors";
import { describeRunResult, runResults } from "../agent/summary";
import { useTheme } from "../theme/useTheme";
import { defineNexusThemes, monacoTheme } from "../editor/monacoThemes";
import {
  AlertTriangle, Ban, Bot, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, FileText, FolderOpen,
  Hourglass, Pencil, Play, Repeat, Square, Timer, Wrench, X, XCircle,
} from "lucide-react";
import Spinner from "./ui/Spinner";
import Alert from "./ui/Alert";
import Button from "./ui/Button";

const END_TEXT = {
  finished: { Icon: CheckCircle2, title: "Done" },
  capped: { Icon: Timer, title: "Stopped at a limit" },
  stuck: { Icon: Repeat, title: "Stopped: the same error kept coming back" },
  stopped: { Icon: Square, title: "Stopped" },
  failed: { Icon: AlertTriangle, title: "The run failed" },
};

// A line icon per agent tool (describeTool's text stays the label)
const TOOL_ICONS = { list_files: FolderOpen, read_file: FileText, write_file: Pencil, add_task: ClipboardList };

function toolIcon(call, result, ok) {
  if (call.name === "run_file") {
    if (!result) return <Spinner size={13} />;
    if (result.status === "unsupported") return <Ban size={13} />;
    return ok === false ? <XCircle size={13} /> : <CheckCircle2 size={13} />;
  }
  const Icon = TOOL_ICONS[call.name] ?? (call.name?.includes("file") ? Pencil : Wrench);
  return <Icon size={13} />;
}

const STATUS_TEXT = {
  pending: "Waiting for review",
  applying: "Saving...",
  accepted: "Accepted",
  rejected: "Rejected",
  undone: "Undone",
  conflict: "Changed since the agent read it",
  failed: "Couldn't save",
  adding: "Adding...",
  added: "Added to the board",
};

function languageFor(path, files) {
  return files.find((file) => file.path === path)?.language ?? undefined;
}

function TimelineItem({ item }) {
  if (item.type === "step") return <li className="agent-timeline__step motion-rise-in">Step {item.step} of {item.maxSteps}</li>;
  if (item.type === "thought") {
    return (
      <li className="motion-fade-in">
        <details className="agent-timeline__thought">
          <summary>Reasoning</summary>
          <p className="small muted agent-text">{item.text}</p>
        </details>
      </li>
    );
  }
  if (item.type === "text") return <li className="small agent-text motion-fade-in">{item.text}</li>;
  if (item.type === "retry") return <li className="small muted agent-timeline__line motion-rise-in"><Hourglass size={13} aria-hidden="true" /> {item.detail} Trying again ({item.attempt}).</li>;
  if (item.type === "rejected") return <li className="small text-danger agent-timeline__line motion-rise-in"><Ban size={13} aria-hidden="true" /> Refused {item.call.name}: {item.call.error}</li>;
  if (item.type === "tool") {
    const { text, detail, ok } = describeTool(item.call, item.result);
    const output = item.call.name === "run_file" && item.result && item.result.status !== "unsupported";
    return (
      <li className={`small agent-timeline__tool motion-rise-in ${ok === false ? "agent-timeline__tool--error" : ""} ${item.call.name === "run_file" && !item.result ? "agent-timeline__tool--running" : ""}`}>
        <span className="agent-timeline__icon" aria-hidden="true">{toolIcon(item.call, item.result, ok)}</span> {text}
        {detail && <span className="muted"> · {detail}</span>}
        {output && (item.result.stdout || item.result.stderr) && (
          <details>
            <summary className="muted">Output</summary>
            {item.result.stdout && <pre className="agent-output mono">{item.result.stdout}</pre>}
            {item.result.stderr && <pre className="agent-output agent-output--error mono">{item.result.stderr}</pre>}
          </details>
        )}
      </li>
    );
  }
  return null;
}

// The end of a run: what it changed (and whether that's been reviewed) and what passed
function resetTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// How many runs are left today, for this user and for the whole server
function QuotaLine({ quota }) {
  if (!quota) return null;
  if (quota.ai_configured === false) {
    return <p className="small text-danger" role="status">{AI_NOT_CONFIGURED_TEXT}</p>;
  }
  if (quota.ai_available === false) {
    return <p className="small text-danger" role="status">The AI's free daily allowance is used up. The agent will work again when it resets.</p>;
  }
  const out = quota.user_remaining === 0 || quota.total_remaining === 0;
  if (out) {
    const why = quota.user_remaining === 0 ? "You've used all your agent runs for today." : "The agent has reached today's limit for everyone.";
    return <p className="small text-danger" role="status">{why} More at {resetTime(quota.resets_at)}.</p>;
  }
  return (
    <p className="small muted" role="status">
      {quota.user_remaining} of {quota.user_limit} runs left today
      {quota.total_remaining < quota.user_remaining ? ` (only ${quota.total_remaining} left for everyone)` : ""}
    </p>
  );
}

function RunSummary({ timeline, entries, runId }) {
  const results = runResults(timeline);
  const changed = entries.filter((entry) => entry.runId === runId);
  const unsupported = results.filter((result) => result.status === "unsupported");
  if (results.length === 0 && changed.length === 0) return null;
  return (
    <div className="agent-summary small">
      {changed.length > 0 && (
        <>
          <h4 className="agent-summary__title">Changed</h4>
          <ul aria-label="Files changed in this run">
            {changed.map((entry) => (
              <li key={entry.key}>
                <span className="mono">{entry.path}</span> <span className="muted">· {entry.before === null ? "new" : "edited"} · {STATUS_TEXT[entry.status]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {results.length > unsupported.length && (
        <>
          <h4 className="agent-summary__title">Ran</h4>
          <ul aria-label="Run results">
            {results.filter((r) => r.status !== "unsupported").map((result) => (
              <li key={result.path} className={result.status === "ok" ? "text-success" : "text-danger"}>
                {result.status === "ok" ? <CheckCircle2 size={13} aria-hidden="true" /> : <XCircle size={13} aria-hidden="true" />} <span className="mono">{result.path}</span> {describeRunResult(result)}
              </li>
            ))}
          </ul>
        </>
      )}
      {unsupported.length > 0 && (
        <p className="muted" role="note">
          {unsupported.map((r) => r.path).join(", ")} can't run in the browser. The agent can run Python and JavaScript;
          run other languages on your own machine.
        </p>
      )}
    </div>
  );
}

function ChangeCard({ entry, store, files, theme }) {
  const [open, setOpen] = useState(entry.status === "pending");
  const isNew = entry.before === null;
  const latest = store.isLatest(entry);
  const label = `${entry.path} (${isNew ? "new file" : "edit"})`;
  return (
    <li className={`agent-change agent-change--${entry.status}`} aria-label={label}>
      <div className="row row--between">
        <button type="button" className="btn btn--link agent-change__path" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />} {entry.path}
        </button>
        <span className="small muted">{isNew ? "New file" : "Edit"} · {STATUS_TEXT[entry.status]}</span>
      </div>
      {entry.error && <p className="small text-danger" role="alert">{entry.error}</p>}
      <div className="row" style={{ "--gap": "0.5rem" }}>
        {entry.status === "pending" && (
          <>
            <Button size="sm" onClick={() => store.accept(entry)}>Accept</Button>
            <Button size="sm" variant="ghost" onClick={() => store.reject(entry)}>Reject</Button>
          </>
        )}
        {entry.status === "conflict" && (
          <>
            <Button size="sm" variant="danger" onClick={() => store.accept(entry, { force: true })}>Overwrite</Button>
            <Button size="sm" variant="ghost" onClick={() => store.reject(entry)}>Reject</Button>
          </>
        )}
        {entry.status === "failed" && (
          <>
            <Button size="sm" onClick={() => store.accept(entry)}>Try again</Button>
            <Button size="sm" variant="ghost" onClick={() => store.reject(entry)}>Reject</Button>
          </>
        )}
        {entry.status === "accepted" && latest && (
          <Button size="sm" variant="ghost" onClick={() => store.undo(entry)}>Undo</Button>
        )}
      </div>
      {open && (
        <div className="agent-change__diff">
          <DiffEditor
            height="320px"
            language={languageFor(entry.path, files)}
            original={entry.before ?? ""}
            modified={entry.after}
            beforeMount={defineNexusThemes}
            theme={monacoTheme(theme)}
            options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, renderSideBySide: false }}
          />
        </div>
      )}
    </li>
  );
}

function TaskCard({ task, store }) {
  return (
    <li className="agent-change" aria-label={`Task ${task.title}`}>
      <div className="row row--between">
        <strong className="small agent-timeline__line"><ClipboardList size={14} aria-hidden="true" /> {task.title}</strong>
        <span className="small muted">{task.priority ?? "medium"} · {STATUS_TEXT[task.status] ?? task.status}</span>
      </div>
      {task.description && <p className="small muted">{task.description}</p>}
      {task.error && <p className="small text-danger" role="alert">{task.error}</p>}
      {(task.status === "pending" || task.status === "failed") && (
        <div className="row" style={{ "--gap": "0.5rem" }}>
          <Button size="sm" onClick={() => store.acceptTask(task)}>Add to board</Button>
          <Button size="sm" variant="ghost" onClick={() => store.rejectTask(task)}>Reject</Button>
        </div>
      )}
    </li>
  );
}

/**
 * The coding agent. The editor passes what the agent may touch:
 *   files                     the project's files (for listing)
 *   readLive(path)            what's in the project now (open tabs included), or null
 *   applyFile(path, content)  save a file, creating it if needed -> { fileId, created }
 *   deleteFile(fileId)        for undoing a file the agent created
 *   createTask(task)          add a task to the board
 */
function AgentPanel({ projectId, files, readLive, applyFile, deleteFile, createTask, onClose }) {
  const { theme } = useTheme();
  const [goal, setGoal] = useState("");
  const [timeline, setTimeline] = useState([]);
  const [running, setRunning] = useState(false);
  const [end, setEnd] = useState(null);
  const [error, setError] = useState("");
  const controller = useRef(null);
  const runIdRef = useRef(null);
  const [runId, setRunId] = useState(null);
  const maxSteps = useRef(8);
  const [session] = useState(() => new AgentSession());
  const [quota, setQuota] = useState(null);
  const refreshQuota = () => fetchAgentQuota().then(setQuota, () => {});

  useEffect(() => {
    let cancelled = false;
    fetchAgentQuota().then((data) => !cancelled && setQuota(data), () => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const store = session.store;

  useEffect(() => {
    session.setDeps({ files, readLive, applyFile, deleteFile, createTask });
  }, [session, files, readLive, applyFile, deleteFile, createTask]);

  // Leaving the editor sends what was kept and stops a run in progress
  useEffect(
    () => () => {
      session.flushReports();
      if (controller.current) {
        controller.current.abort();
        session.stopCode();
        if (runIdRef.current) stopAgentRun(runIdRef.current).catch(() => {});
      }
    },
    [session]
  );

  useSyncExternalStore(store.subscribe, store.getVersion);

  const add = (item) => setTimeline((previous) => [...previous, { key: `${previous.length}-${item.type}`, ...item }]);

  function onEvent(event) {
    if (event.type === "run") {
      runIdRef.current = event.run.id;
      setRunId(event.run.id);
      maxSteps.current = event.run.limits?.max_steps ?? 8;
      session.startRun(event.run.id);
      refreshQuota();
    } else if (event.type === "step") {
      add({ type: "step", step: event.step, maxSteps: maxSteps.current });
    } else if (event.type === "thought" || event.type === "text") {
      // Pieces of one reply join up
      setTimeline((previous) => {
        const last = previous[previous.length - 1];
        if (last && last.type === event.type) return [...previous.slice(0, -1), { ...last, text: last.text + event.text }];
        return [...previous, { key: `${previous.length}-${event.type}`, type: event.type, text: event.text }];
      });
    } else if (event.type === "tool_call") {
      add({ type: "tool", id: event.call.id, call: event.call, result: null });
    } else if (event.type === "tool_result") {
      setTimeline((previous) => previous.map((item) => (item.type === "tool" && item.id === event.call.id ? { ...item, result: event.result } : item)));
    } else if (event.type === "tool_rejected") {
      add({ type: "rejected", call: event.call });
    } else if (event.type === "retry") {
      add({ type: "retry", attempt: event.attempt, detail: event.detail });
    } else if (event.type === "end") {
      // The closing message is the summary, shown once below the timeline
      if (event.summary) {
        setTimeline((previous) => {
          const last = previous[previous.length - 1];
          return last?.type === "text" && last.text.trim() === event.summary.trim() ? previous.slice(0, -1) : previous;
        });
      }
      setEnd(event);
    }
  }

  async function start(event) {
    event.preventDefault();
    if (!goal.trim() || running) return;
    setError("");
    setEnd(null);
    setTimeline([]);
    setRunning(true);
    controller.current = new AbortController();
    try {
      const result = await runAgent({ projectId, goal: goal.trim(), tools: session.tools, onEvent, signal: controller.current.signal });
      // A run that failed here may still be open on the server: end it there too
      if (result.status === "failed" && runIdRef.current) stopAgentRun(runIdRef.current).catch(() => {});
    } catch (err) {
      setError(aiErrorText(err));
    } finally {
      setRunning(false);
      controller.current = null;
      refreshQuota();
    }
  }

  function stop() {
    controller.current?.abort();
    session.stopCode();
    if (runIdRef.current) stopAgentRun(runIdRef.current).catch(() => {});
  }

  const pending = store.pendingCount();
  const endText = end ? END_TEXT[end.status] ?? END_TEXT.failed : null;

  return (
    <section className="card agent-panel" aria-labelledby="agent-title">
      <div className="row row--between">
        <h2 id="agent-title" className="section-title agent-panel__title"><Bot size={18} aria-hidden="true" /> Agent</h2>
        {onClose && <Button size="icon" variant="subtle" onClick={onClose} aria-label="Close the agent"><X size={16} aria-hidden="true" /></Button>}
      </div>
      <form onSubmit={start} className="stack" style={{ "--gap": "0.5rem" }}>
        <label htmlFor="agent-goal" className="small">Goal</label>
        <textarea
          id="agent-goal"
          className="input"
          rows={2}
          maxLength={2000}
          value={goal}
          disabled={running}
          placeholder="Build a todo CLI in Python with tests"
          onChange={(e) => setGoal(e.target.value)}
        />
        <div className="row row--between">
          <label className="small row" style={{ "--gap": "0.4rem" }}>
            <input type="checkbox" checked={store.autoAccept} onChange={(e) => store.setAutoAccept(e.target.checked)} />
            Save the agent's changes without asking (this session only)
          </label>
          <div className="row" style={{ "--gap": "0.5rem" }}>
            {running ? (
              <Button variant="danger" onClick={stop} icon={<Square size={12} aria-hidden="true" />}>Stop</Button>
            ) : (
              <Button type="submit" disabled={!goal.trim() || quota?.user_remaining === 0 || quota?.total_remaining === 0 || quota?.ai_available === false || quota?.ai_configured === false} icon={<Play size={13} aria-hidden="true" />}>Start</Button>
            )}
          </div>
        </div>
        <QuotaLine quota={quota} />
        <p className="hint">The agent writes files and runs Python and JavaScript in your browser, with no network access. You review every change before it's saved.</p>
      </form>
      <Alert onDismiss={() => setError("")}>{error}</Alert>

      <div className="agent-panel__body">
        <div>
          <h3 className="small muted">Timeline</h3>
          {timeline.length === 0 && !running && <p className="small muted">Nothing yet. Describe a goal and press Start.</p>}
          <ol className="agent-timeline" aria-label="Agent timeline" aria-live="polite">
            {timeline.map((item) => <TimelineItem key={item.key} item={item} />)}
          </ol>
          {running && <p role="status" className="small muted agent-working"><Spinner size={13} /> Working...</p>}
          {end && (
            <div className={`agent-end agent-end--${end.status} motion-scale-in`} role="status">
              <strong className="agent-end__title"><endText.Icon size={16} aria-hidden="true" />{endText.title}</strong>
              {end.reason && <p className="small">{end.reason}</p>}
              {end.summary && <p className="small agent-text">{end.summary}</p>}
              <RunSummary timeline={timeline} entries={store.entries} runId={runId} />
            </div>
          )}
        </div>
        <div>
          <div className="row row--between">
            <h3 className="small muted">Changes {pending > 0 ? `(${pending} to review)` : ""}</h3>
            {pending > 1 && (
              <div className="row" style={{ "--gap": "0.5rem" }}>
                <Button size="sm" onClick={() => store.acceptAll()}>Accept all</Button>
                <Button size="sm" variant="ghost" onClick={() => store.rejectAll()}>Reject all</Button>
              </div>
            )}
          </div>
          {store.entries.length === 0 && store.tasks.length === 0 && <p className="small muted">The agent's file changes and tasks appear here for you to review.</p>}
          <ul className="agent-changes" aria-label="Changes to review">
            {store.entries.map((entry) => (
              <ChangeCard key={entry.key} entry={entry} store={store} files={files} theme={theme} />
            ))}
            {store.tasks.map((task) => (
              <TaskCard key={task.key} task={task} store={store} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default AgentPanel;
