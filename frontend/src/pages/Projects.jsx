import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL;

function Projects() {
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const navigate = useNavigate();

  const token = localStorage.getItem("token");

  useEffect(() => {
    fetchProjects();
  }, []);

  function fetchProjects() {
    fetch(`${API_URL}/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => setProjects(data.projects));
  }

  function createProject() {
    if (!name.trim()) return;
    fetch(`${API_URL}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, description }),
    })
      .then((res) => res.json())
      .then(() => {
        setName("");
        setDescription("");
        fetchProjects();
      });
  }

  function deleteProject(e, projectId) {
    e.stopPropagation();
    fetch(`${API_URL}/projects/${projectId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).then(() => fetchProjects());
  }

  function logout() {
    localStorage.removeItem("token");
    navigate("/login");
  }

  function connectGithub() {
    fetch(`${API_URL}/auth/github/login`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        window.location.href = data.url;
      });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0D1117", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: "700px", margin: "0 auto", padding: "3rem 1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", color: "#58A6FF", marginBottom: "0.3rem" }}>
              $ your-workspace
            </div>
            <h1 style={{ fontFamily: "'JetBrains Mono', monospace", color: "#E6EDF3", fontSize: "24px", margin: 0, fontWeight: 600 }}>
              My Projects
            </h1>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={() => navigate("/dashboard")} style={ghostButtonStyle}>📊 Dashboard</button>
            <button onClick={() => navigate("/ai")} style={aiButtonStyle}>✨ AI Assistant</button>
            <button onClick={connectGithub} style={ghostButtonStyle}>🐙 Connect GitHub</button>
            <button onClick={logout} style={ghostButtonStyle}>Log out</button>
          </div>
        </div>

        <div style={{ background: "#161B22", border: "1px solid #30363D", borderRadius: "10px", padding: "1.25rem", marginBottom: "2rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ ...inputStyle, flex: "1 1 180px" }}
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ ...inputStyle, flex: "2 1 220px" }}
          />
          <button onClick={createProject} style={primaryButtonStyle}>+ New Project</button>
        </div>

        {projects.length === 0 && (
          <p style={{ color: "#8B949E", fontSize: "14px" }}>No projects yet — create your first one above.</p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              style={cardStyle}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <strong style={{ color: "#E6EDF3", fontSize: "15px" }}>{project.name}</strong>
                  {project.description && (
                    <p style={{ margin: "4px 0 0", color: "#8B949E", fontSize: "13px" }}>{project.description}</p>
                  )}
                </div>
                <button onClick={(e) => deleteProject(e, project.id)} style={deleteButtonStyle}>
                  Delete
                </button>
              </div>
            </div>
          ))}
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

const ghostButtonStyle = {
  padding: "8px 14px",
  background: "transparent",
  color: "#8B949E",
  border: "1px solid #30363D",
  borderRadius: "6px",
  fontSize: "13px",
  cursor: "pointer",
};

const aiButtonStyle = {
  padding: "8px 14px",
  background: "#58A6FF",
  color: "#0D1117",
  border: "none",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

const cardStyle = {
  background: "#161B22",
  border: "1px solid #30363D",
  borderRadius: "10px",
  padding: "1rem 1.25rem",
  cursor: "pointer",
  transition: "border-color 0.15s",
};

const deleteButtonStyle = {
  padding: "4px 10px",
  background: "transparent",
  color: "#F85149",
  border: "1px solid #F85149",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "12px",
};

export default Projects;