import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { apiFetch, apiFetchAll, wsUrl } from "../api/client";
import { useAuth } from "../auth/useAuth";

// Matches the server-side limit
const MAX_CHAT_MESSAGE_LENGTH = 2000;

function Board() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [messages, setMessages] = useState([]);
  // Cursor for "Load older messages"; null once the oldest message is loaded
  const [olderCursor, setOlderCursor] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState("");
  const [error, setError] = useState("");
  const ws = useRef(null);
  const { user } = useAuth();

  const fetchTasks = useCallback(() => {
    return apiFetchAll(`/projects/${projectId}/tasks`, "tasks")
      .then(setTasks)
      .catch((err) => setError(err.message));
  }, [projectId]);

  const fetchFiles = useCallback(() => {
    return apiFetchAll(`/projects/${projectId}/files`, "files")
      .then(setFiles)
      .catch((err) => setError(err.message));
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
    const socket = new WebSocket(wsUrl(`/ws/projects/${projectId}/chat`));
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
    // The server refuses the socket if the token is missing/expired or the
    // project isn't ours, which shows up here as a close.
    socket.onclose = () => setChatError("Chat disconnected. Refresh the page to reconnect.");

    return () => {
      socket.onclose = null;
      socket.close();
    };
  }, [projectId]);

  function createTask() {
    if (!title.trim()) return;
    setError("");
    apiFetch(`/projects/${projectId}/tasks`, { method: "POST", body: { title } })
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

  function deleteTask(taskId) {
    setError("");
    apiFetch(`/tasks/${taskId}`, { method: "DELETE" })
      .then(() => fetchTasks())
      .catch((err) => setError(err.message));
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

  function deleteFile(fileId) {
    setError("");
    apiFetch(`/files/${fileId}`, { method: "DELETE" })
      .then(() => fetchFiles())
      .catch((err) => setError(err.message));
  }

  function sendMessage() {
    if (!chatInput.trim()) return;
    if (ws.current?.readyState !== WebSocket.OPEN) {
      setChatError("Chat is not connected. Refresh the page to reconnect.");
      return;
    }
    // The server attaches our username from the token
    ws.current.send(JSON.stringify({ content: chatInput }));
    setChatInput("");
  }

  function handleDragEnd(result) {
    const { destination, draggableId } = result;
    if (!destination) return;

    const newStatus = destination.droppableId;
    if (newStatus === result.source.droppableId) return;
    updateTaskStatus(draggableId, newStatus);

    setTasks((prev) =>
      prev.map((t) =>
        t.id.toString() === draggableId ? { ...t, status: newStatus } : t
      )
    );
  }

  const columns = {
    todo: tasks.filter((t) => t.status === "todo"),
    in_progress: tasks.filter((t) => t.status === "in_progress"),
    done: tasks.filter((t) => t.status === "done"),
  };

  const columnMeta = {
    todo: { title: "To Do", accent: "#8B949E" },
    in_progress: { title: "In Progress", accent: "#58A6FF" },
    done: { title: "Done", accent: "#7EE787" },
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0D1117", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "3rem 1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <button onClick={() => navigate("/projects")} style={backButtonStyle}>← All projects</button>
              <button onClick={() => navigate(`/projects/${projectId}/editor`)} style={{ ...backButtonStyle, marginLeft: "1rem" }}>
                💻 Open Code Editor
              </button>
              <button onClick={() => navigate(`/projects/${projectId}/meeting`)} style={{ ...backButtonStyle, marginLeft: "1rem" }}>
                📹 Start Meeting
              </button>
            </div>
            <h1 style={{ fontFamily: "'JetBrains Mono', monospace", color: "#E6EDF3", fontSize: "24px", margin: "0.5rem 0 0", fontWeight: 600 }}>
              Project Board
            </h1>
          </div>
        </div>

        {error && (
          <p role="alert" style={{ color: "#F85149", fontSize: "13px", marginBottom: "1rem" }}>{error}</p>
        )}

        <div style={{ background: "#161B22", border: "1px solid #30363D", borderRadius: "10px", padding: "1.25rem", marginBottom: "2rem", display: "flex", gap: "0.75rem" }}>
          <input
            type="text"
            placeholder="New task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={createTask} style={primaryButtonStyle}>+ Add Task</button>
        </div>

        <DragDropContext onDragEnd={handleDragEnd}>
          <div style={{ display: "flex", gap: "1rem" }}>
            {Object.keys(columns).map((status) => (
              <Droppable droppableId={status} key={status}>
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    style={{
                      flex: 1,
                      background: "#161B22",
                      border: "1px solid #30363D",
                      borderRadius: "10px",
                      padding: "1rem",
                      minHeight: "400px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "1rem" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: columnMeta[status].accent }} />
                      <h3 style={{ color: "#E6EDF3", fontSize: "14px", margin: 0, fontWeight: 600 }}>
                        {columnMeta[status].title}
                      </h3>
                      <span style={{ color: "#8B949E", fontSize: "12px" }}>{columns[status].length}</span>
                    </div>

                    {columns[status].map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id.toString()} index={index}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            style={{
                              background: "#0D1117",
                              border: "1px solid #30363D",
                              borderRadius: "8px",
                              padding: "0.75rem",
                              marginBottom: "0.5rem",
                              ...provided.draggableProps.style,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ color: "#E6EDF3", fontSize: "13px" }}>{task.title}</span>
                              <button onClick={() => deleteTask(task.id)} style={deleteButtonStyle}>✕</button>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            ))}
          </div>
        </DragDropContext>

        <div style={{ marginTop: "2.5rem", display: "flex", gap: "1.5rem", alignItems: "stretch" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <h3 style={{ color: "#E6EDF3", fontSize: "16px", fontWeight: 600, marginBottom: "1rem" }}>
              📁 Files
            </h3>

            <div style={{ background: "#161B22", border: "1px solid #30363D", borderRadius: "10px", padding: "1.25rem", flex: 1 }}>
              <label style={uploadLabelStyle}>
                {uploading ? "Uploading..." : "+ Upload a file"}
                <input type="file" onChange={uploadFile} disabled={uploading} style={{ display: "none" }} />
              </label>

              {files.length === 0 && (
                <p style={{ color: "#8B949E", fontSize: "13px", marginTop: "1rem" }}>No files uploaded yet.</p>
              )}

              <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {files.map((file) => (
                  <div key={file.id} style={fileRowStyle}>
                    <a href={file.url} target="_blank" rel="noreferrer" style={fileLinkStyle}>
                      {file.filename}
                    </a>
                    <button onClick={() => deleteFile(file.id)} style={deleteButtonStyle}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <h3 style={{ color: "#E6EDF3", fontSize: "16px", fontWeight: 600, marginBottom: "1rem" }}>
              💬 Chat
            </h3>

            <div style={{ background: "#161B22", border: "1px solid #30363D", borderRadius: "10px", padding: "1.25rem", flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={chatBoxStyle}>
                {olderCursor !== null && (
                  <button onClick={loadOlderMessages} disabled={loadingOlder} style={{ ...backButtonStyle, marginBottom: "0.75rem" }}>
                    {loadingOlder ? "Loading..." : "↑ Load older messages"}
                  </button>
                )}
                {messages.length === 0 && (
                  <p style={{ color: "#8B949E", fontSize: "13px" }}>No messages yet. Say hello!</p>
                )}
                {messages.map((msg, idx) => (
                  <div key={msg.id || idx} style={{ marginBottom: "0.5rem" }}>
                    <span style={{ color: msg.username === user?.username ? "#7EE787" : "#58A6FF", fontSize: "12px", fontWeight: 600 }}>
                      {msg.username === user?.username ? `${msg.username} (you)` : msg.username}:{" "}
                    </span>
                    <span style={{ color: "#E6EDF3", fontSize: "13px" }}>{msg.content}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  maxLength={MAX_CHAT_MESSAGE_LENGTH}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button onClick={sendMessage} style={primaryButtonStyle}>Send</button>
              </div>
              {chatError && (
                <p role="alert" style={{ color: "#F85149", fontSize: "12px", margin: "0.5rem 0 0" }}>{chatError}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  padding: "9px 12px",
  background: "#0D1117",
  border: "1px solid #30363D",
  borderRadius: "6px",
  color: "#E6EDF3",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
};

const primaryButtonStyle = {
  padding: "9px 16px",
  background: "#58A6FF",
  color: "#0D1117",
  border: "none",
  borderRadius: "6px",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const backButtonStyle = {
  padding: "0",
  background: "transparent",
  color: "#58A6FF",
  border: "none",
  fontSize: "13px",
  cursor: "pointer",
};

const deleteButtonStyle = {
  padding: "2px 7px",
  background: "transparent",
  color: "#F85149",
  border: "1px solid #30363D",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "11px",
};

const uploadLabelStyle = {
  display: "inline-block",
  padding: "8px 14px",
  background: "#58A6FF",
  color: "#0D1117",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

const fileRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "#0D1117",
  border: "1px solid #30363D",
  borderRadius: "6px",
  padding: "8px 12px",
};

const fileLinkStyle = {
  color: "#58A6FF",
  fontSize: "13px",
  textDecoration: "none",
};

const chatBoxStyle = {
  maxHeight: "200px",
  overflowY: "auto",
  minHeight: "100px",
  flex: 1,
};

export default Board;