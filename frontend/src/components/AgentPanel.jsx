import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { AgentSession } from "../agent/agentSession";
import { describeTool } from "../agent/describeTool";
import { runAgent, stopAgentRun } from "../agent/runAgent";
import { useTheme } from "../theme/useTheme";
import Alert from "./ui/Alert";
import Button from "./ui/Button";

const END_TEXT = {
  finished: { icon: "✅", title: "Done" },
  capped: { icon: "⏱", title: "Stopped at a limit" },
  stuck: { icon: "🔁", title: "Stopped: the same error kept coming back" },
  stopped: { icon: "■", title: "Stopped" },
  failed: { icon: "⚠️", title: "The run failed" },
};

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
  if (item.type === "step") return <li className="agent-timeline__step">Step {item.step} of {item.maxSteps}</li>;
  if (item.type === "thought") {
    return (
      <li>
        <details className="agent-timeline__thought">
          <summary>Reasoning</summary>
          <p className="small muted agent-text">{item.text}</p>
        </details>
      </li>
    );
  }
  if (item.type === "text") return <li className="small agent-text">{item.text}</li>;
  if (item.type === "retry") return <li className="small muted">⏳ {item.detail} Trying again ({item.attempt}).</li>;
  if (item.type === "rejected") return <li className="small text-danger">⛔ Refused {item.call.name}: {item.call.error}</li>;
  if (item.type === "tool") {
    const { icon, text, detail, ok } = describeTool(item.call, item.result);
    const output = item.call.name === "run_file" && item.result && item.result.status !== "unsupported";
    return (
      <li className={`small agent-timeline__tool ${ok === false ? "text-danger" : ""}`}>
        <span aria-hidden="true">{icon}</span> {text}
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

function ChangeCard({ entry, store, files, theme }) {
  const [open, setOpen] = useState(entry.status === "pending");
  const isNew = entry.before === null;
  const latest = store.isLatest(entry);
  const label = `${entry.path} (${isNew ? "new file" : "edit"})`;
  return (
    <li className={`agent-change agent-change--${entry.status}`} aria-label={label}>
      <div className="row row--between">
        <button type="button" className="btn btn--link agent-change__path" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "▾" : "▸"} {entry.path}
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
            theme={theme === "dark" ? "vs-dark" : "light"}
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
        <strong className="small">📋 {task.title}</strong>
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
  const maxSteps = useRef(8);
  const [session] = useState(() => new AgentSession());
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
      maxSteps.current = event.run.limits?.max_steps ?? 8;
      session.startRun(event.run.id);
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
      await runAgent({ projectId, goal: goal.trim(), tools: session.tools, onEvent, signal: controller.current.signal });
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
      controller.current = null;
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
        <h2 id="agent-title" className="section-title">🤖 Agent</h2>
        {onClose && <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close the agent">✕</Button>}
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
              <Button variant="danger" onClick={stop}>■ Stop</Button>
            ) : (
              <Button type="submit" disabled={!goal.trim()}>▶ Start</Button>
            )}
          </div>
        </div>
        <p className="hint">The agent writes files and runs Python and JavaScript in your browser. You review every change before it's saved.</p>
      </form>
      <Alert onDismiss={() => setError("")}>{error}</Alert>

      <div className="agent-panel__body">
        <div>
          <h3 className="small muted">Timeline</h3>
          {timeline.length === 0 && !running && <p className="small muted">Nothing yet. Describe a goal and press Start.</p>}
          <ol className="agent-timeline" aria-label="Agent timeline" aria-live="polite">
            {timeline.map((item) => <TimelineItem key={item.key} item={item} />)}
          </ol>
          {running && <p role="status" className="small muted">Working...</p>}
          {end && (
            <div className={`agent-end agent-end--${end.status}`} role="status">
              <strong>{endText.icon} {endText.title}</strong>
              {end.reason && <p className="small">{end.reason}</p>}
              {end.summary && <p className="small agent-text">{end.summary}</p>}
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
