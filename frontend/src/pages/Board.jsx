import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { apiFetch, apiFetchAll, socketUrl } from "../api/client";
import { useAuth } from "../auth/useAuth";
import Alert from "../components/ui/Alert";
import BackLink from "../components/ui/BackLink";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Input from "../components/ui/Input";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";

// Matches the server-side limit
const MAX_CHAT_MESSAGE_LENGTH = 2000;
// Mirrors the backend allowlist (app/services/storage.py); the server still validates
const UPLOAD_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.zip,.txt,.md,.csv,.json,.log,.py,.js,.jsx,.ts,.tsx,.java,.c,.cpp,.h,.css,.sql,.yml,.yaml,.toml,.ini";

const COLUMNS = [
  { status: "todo", title: "To Do", dot: "var(--color-text-muted)" },
  { status: "in_progress", title: "In Progress", dot: "var(--color-accent)" },
  { status: "done", title: "Done", dot: "var(--color-success)" },
];

function Board() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState([]);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [messages, setMessages] = useState([]);
  // Cursor for "Load older messages"; null once the oldest message is loaded
  const [olderCursor, setOlderCursor] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState("");
  const [error, setError] = useState("");
  const [toDelete, setToDelete] = useState(null); // { kind: "task" | "file", id, name }
  const [deleting, setDeleting] = useState(false);
  const ws = useRef(null);

  const fetchTasks = useCallback(() => {
    return apiFetchAll(`/projects/${projectId}/tasks`, "tasks")
      .then(setTasks)
      .catch((err) => setError(err.message))
      .finally(() => setTasksLoaded(true));
  }, [projectId]);

  const fetchFiles = useCallback(() => {
    return apiFetchAll(`/projects/${projectId}/files`, "files")
      .then(setFiles)
      .catch((err) => setError(err.message))
      .finally(() => setFilesLoaded(true));
  }, [projectId]);

  useEffect(() => {
    fetchTasks();
    fetchFiles();
    // The API returns newest first; the chat box shows the oldest at the top
    apiFetch(`/projects/${projectId}/messages`)
      .then((data) => {
        setMessages([...(data.messages ?? [])].reverse());
        setOlderCursor(data.next_cursor ?? null);
      })
      .catch((err) => setError(err.message));
  }, [projectId, fetchTasks, fetchFiles]);

  function loadOlderMessages() {
    if (olderCursor === null) return;
    setLoadingOlder(true);
    apiFetch(`/projects/${projectId}/messages?before=${olderCursor}`)
      .then((data) => {
        setMessages((prev) => [...[...(data.messages ?? [])].reverse(), ...prev]);
        setOlderCursor(data.next_cursor ?? null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingOlder(false));
  }

  useEffect(() => {
    let socket = null;
    let cancelled = false;

    // Get a single-use ticket, then connect (unless we unmounted meanwhile)
    socketUrl(`/ws/projects/${projectId}/chat`, projectId)
      .then((url) => {
        if (cancelled) return;
        socket = new WebSocket(url);
        ws.current = socket;

        socket.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.type === "error") {
            setChatError(message.detail);
            return;
          }
          setChatError("");
          setMessages((prev) => [...prev, message]);
        };
        // The server refuses the socket if the ticket is invalid or the
        // project isn't ours, which shows up here as a close.
        socket.onclose = () => setChatError("Chat disconnected. Refresh the page to reconnect.");
      })
      .catch(() => {
        if (!cancelled) setChatError("Couldn't connect to chat. Refresh the page to try again.");
      });

    return () => {
      cancelled = true;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [projectId]);

  function createTask(event) {
    event.preventDefault();
    if (!title.trim()) return;
    setError("");
    apiFetch(`/projects/${projectId}/tasks`, { method: "POST", body: { title: title.trim() } })
      .then(() => {
        setTitle("");
        return fetchTasks();
      })
      .catch((err) => setError(err.message));
  }

  function updateTaskStatus(taskId, newStatus) {
    // Always resync afterwards: on failure this undoes the optimistic move
    apiFetch(`/tasks/${taskId}`, { method: "PUT", body: { status: newStatus } })
      .catch((err) => setError(err.message))
      .finally(() => fetchTasks());
  }

  function uploadFile(e) {
    const selectedFile = e.target.files[0];
    e.target.value = "";
    if (!selectedFile) return;

    const form = new FormData();
    form.append("file", selectedFile);

    setError("");
    setUploading(true);
    apiFetch(`/projects/${projectId}/files`, { method: "POST", form })
      .then(() => fetchFiles())
      .catch((err) => setError(err.message))
      .finally(() => setUploading(false));
  }

  function confirmDelete() {
    const { kind, id } = toDelete;
    setDeleting(true);
    setError("");
    apiFetch(kind === "task" ? `/tasks/${id}` : `/files/${id}`, { method: "DELETE" })
      .then(() => (kind === "task" ? fetchTasks() : fetchFiles()))
      .catch((err) => setError(err.message))
      .finally(() => {
        setDeleting(false);
        setToDelete(null);
      });
  }

  function sendMessage(event) {
    event.preventDefault();
    if (!chatInput.trim()) return;
    if (ws.current?.readyState !== WebSocket.OPEN) {
      setChatError("Chat is not connected. Refresh the page to reconnect.");
      return;
    }
    // The server attaches our username from the ticket
    ws.current.send(JSON.stringify({ content: chatInput }));
    setChatInput("");
  }

  function handleDragEnd(result) {
    const { destination, draggableId } = result;
    if (!destination) return;
    const newStatus = destination.droppableId;
    if (newStatus === result.source.droppableId) return;
    updateTaskStatus(draggableId, newStatus);
    setTasks((prev) => prev.map((t) => (t.id.toString() === draggableId ? { ...t, status: newStatus } : t)));
  }

  return (
    <Page width={1100}>
      <div className="row">
        <BackLink to="/projects">All projects</BackLink>
        <Link className="btn btn--link" to={`/projects/${projectId}/editor`}>💻 Open Code Editor</Link>
        <Link className="btn btn--link" to={`/projects/${projectId}/meeting`}>📹 Start Meeting</Link>
      </div>
      <PageHeader eyebrow={`board --project ${projectId}`} title="Project Board" />

      <Alert onDismiss={() => setError("")}>{error}</Alert>

      <Card as="form" onSubmit={createTask} className="row" style={{ marginBottom: "2rem" }}>
        <Input label="New task title" hideLabel placeholder="New task title" value={title} onChange={(e) => setTitle(e.target.value)} className="grow" />
        <Button type="submit" disabled={!title.trim()}>+ Add Task</Button>
      </Card>

      {!tasksLoaded && <p role="status" className="muted">Loading tasks...</p>}

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="kanban">
          {COLUMNS.map(({ status, title: columnTitle, dot }) => {
            const columnTasks = tasks.filter((t) => t.status === status);
            return (
              <Droppable droppableId={status} key={status}>
                {(provided) => (
                  <section ref={provided.innerRef} {...provided.droppableProps} className="card kanban__column" aria-label={`${columnTitle} column`}>
                    <div className="row" style={{ "--gap": "8px", marginBottom: "1rem" }}>
                      <span className="kanban__dot" style={{ background: dot }} />
                      <h2 className="small" style={{ margin: 0, fontWeight: 600 }}>{columnTitle}</h2>
                      <span className="muted small">{columnTasks.length}</span>
                    </div>
                    {tasksLoaded && columnTasks.length === 0 && <p className="hint">Drop tasks here</p>}
                    {columnTasks.map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id.toString()} index={index}>
                        {(dragProvided) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                            className="card card--inset"
                            style={{ marginBottom: "0.5rem", ...dragProvided.draggableProps.style }}
                          >
                            <div className="row row--between">
                              <span className="small">{task.title}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Delete task ${task.title}`}
                                onClick={() => setToDelete({ kind: "task", id: task.id, name: task.title })}
                              >
                                ✕
                              </Button>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </section>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>
      <p className="hint">Tip: tasks can be moved with the keyboard too: focus a task, press Space, use the arrow keys, then Space again.</p>

      <div className="split" style={{ marginTop: "2.5rem" }}>
        <section className="stack">
          <h2 className="section-title">📁 Files</h2>
          <Card className="grow">
            <label className="btn btn--primary">
              {uploading ? "Uploading..." : "+ Upload a file"}
              <input type="file" accept={UPLOAD_ACCEPT} onChange={uploadFile} disabled={uploading} className="visually-hidden" />
            </label>
            <p className="hint">Images, PDFs, ZIPs and text/code files, up to 10 MB.</p>

            {!filesLoaded && <p role="status" className="muted small" style={{ marginTop: "1rem" }}>Loading files...</p>}
            {filesLoaded && files.length === 0 && <p className="muted small" style={{ marginTop: "1rem" }}>No files uploaded yet.</p>}

            <ul className="stack" style={{ marginTop: "1rem", listStyle: "none", padding: 0, "--gap": "0.5rem" }}>
              {files.map((file) => (
                <li key={file.id} className="card card--inset row row--between">
                  <a href={file.url} target="_blank" rel="noreferrer" className="btn btn--link">{file.filename}</a>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete file ${file.filename}`}
                    onClick={() => setToDelete({ kind: "file", id: file.id, name: file.filename })}
                  >
                    ✕
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <section className="stack">
          <h2 className="section-title">💬 Chat</h2>
          <Card className="grow stack">
            <div className="chat-log" role="log" aria-live="polite" aria-label="Chat messages">
              {olderCursor !== null && (
                <Button variant="link" onClick={loadOlderMessages} disabled={loadingOlder}>
                  {loadingOlder ? "Loading..." : "↑ Load older messages"}
                </Button>
              )}
              {messages.length === 0 && <p className="muted small">No messages yet. Say hello!</p>}
              {messages.map((msg, idx) => {
                const mine = msg.username === user?.username;
                return (
                  <p key={msg.id || idx} className="small" style={{ marginBottom: "0.5rem" }}>
                    <strong className={mine ? "text-success" : ""} style={mine ? undefined : { color: "var(--color-accent)" }}>
                      {mine ? `${msg.username} (you)` : msg.username}:
                    </strong>{" "}
                    {msg.content}
                  </p>
                );
              })}
            </div>

            <form onSubmit={sendMessage} className="row">
              <Input
                label="Message"
                hideLabel
                placeholder="Type a message..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                maxLength={MAX_CHAT_MESSAGE_LENGTH}
                className="grow"
              />
              <Button type="submit">Send</Button>
            </form>
            {chatError && <p role="alert" className="small text-danger">{chatError}</p>}
          </Card>
        </section>
      </div>

      {toDelete && (
        <ConfirmDialog
          title={toDelete.kind === "task" ? "Delete this task?" : "Delete this file?"}
          message={`"${toDelete.name}" will be permanently deleted.`}
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </Page>
  );
}

export default Board;
