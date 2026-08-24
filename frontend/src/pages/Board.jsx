import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

const API_URL = import.meta.env.VITE_API_URL;
const WS_URL = API_URL.replace("http", "ws");

function Board() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const ws = useRef(null);
  const username = "govind";

  const token = localStorage.getItem("token");

  useEffect(() => {
    fetchTasks();
    fetchFiles();
    fetchMessages();
    connectWebSocket();

    return () => {
      if (ws.current) ws.current.close();
    };
  }, []);

  function fetchTasks() {
    fetch(`${API_URL}/projects/${projectId}/tasks`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => setTasks(data.tasks));
  }

  function createTask() {
    if (!title.trim()) return;
    fetch(`${API_URL}/projects/${projectId}/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title }),
    })
      .then((res) => res.json())
      .then(() => {
        setTitle("");
        fetchTasks();
      });
  }

  function updateTaskStatus(taskId, newStatus) {
    fetch(`${API_URL}/tasks/${taskId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: newStatus }),
    }).then(() => fetchTasks());
  }

  function deleteTask(taskId) {
    fetch(`${API_URL}/tasks/${taskId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).then(() => fetchTasks());
  }

  function fetchFiles() {
    fetch(`${API_URL}/projects/${projectId}/files`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => setFiles(data.files));
  }

  function uploadFile(e) {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append("file", selectedFile);

    setUploading(true);
    fetch(`${API_URL}/projects/${projectId}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
      .then((res) => res.json())
      .then(() => fetchFiles())
      .finally(() => setUploading(false));
  }

  function deleteFile(fileId) {
    fetch(`${API_URL}/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).then(() => fetchFiles());
  }

  function fetchMessages() {
    fetch(`${API_URL}/projects/${projectId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => setMessages(data.messages));
  }

  function connectWebSocket() {
    ws.current = new WebSocket(`${WS_URL}/ws/projects/${projectId}/chat`);

    ws.current.onmessage = (event) => {
      const message = JSON.parse(event.data);
      setMessages((prev) => [...prev, message]);
    };
  }

  function sendMessage() {
    if (!chatInput.trim() || !ws.current) return;
    ws.current.send(JSON.stringify({ username, content: chatInput }));
    setChatInput("");
  }

  function handleDragEnd(result) {
    const { destination, draggableId } = result;
    if (!destination) return;

    const newStatus = destination.droppableId;
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
                {messages.length === 0 && (
                  <p style={{ color: "#8B949E", fontSize: "13px" }}>No messages yet. Say hello!</p>
                )}
                {messages.map((msg, idx) => (
                  <div key={msg.id || idx} style={{ marginBottom: "0.5rem" }}>
                    <span style={{ color: "#58A6FF", fontSize: "12px", fontWeight: 600 }}>{msg.username}: </span>
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
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button onClick={sendMessage} style={primaryButtonStyle}>Send</button>
              </div>
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