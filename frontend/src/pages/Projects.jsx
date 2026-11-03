import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch, apiFetchAll } from "../api/client";
import { useAuth } from "../auth/useAuth";

const GITHUB_MESSAGES = {
  connected: { text: "GitHub account connected.", color: "#7EE787" },
  error: { text: "Couldn't connect your GitHub account. Please try again.", color: "#F85149" },
};

function Projects() {
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const isAdmin = Boolean(user?.is_admin);
  const [searchParams] = useSearchParams();
  // Set by the backend when it redirects back here after GitHub OAuth
  const githubMessage = GITHUB_MESSAGES[searchParams.get("github")];
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchProjects = useCallback(() => {
    return apiFetchAll("/projects", "projects")
      .then(setProjects)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  function createProject() {
    if (!name.trim()) return;
    setError("");
    apiFetch("/projects", { method: "POST", body: { name, description } })
      .then(() => {
        setName("");
        setDescription("");
        return fetchProjects();
      })
      .catch((err) => setError(err.message));
  }

  function deleteProject(e, projectId) {
    e.stopPropagation();
    setError("");
    apiFetch(`/projects/${projectId}`, { method: "DELETE" })
      .then(() => fetchProjects())
      .catch((err) => setError(err.message));
  }

  function logout() {
    signOut();
    navigate("/login");
  }

  function connectGithub() {
    setError("");
    apiFetch("/auth/github/login")
      .then((data) => {
        window.location.href = data.url;
      })
      .catch((err) => setError(err.message));
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0D1117", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: "700px", margin: "0 auto", padding: "3rem 1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", color: "#58A6FF", marginBottom: "0.3rem" }}>
              $ {user ? `${user.username}-workspace` : "your-workspace"}
            </div>
            <h1 style={{ fontFamily: "'JetBrains Mono', monospace", color: "#E6EDF3", fontSize: "24px", margin: 0, fontWeight: 600 }}>
              My Projects
            </h1>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {isAdmin && (
              <button onClick={() => navigate("/admin")} style={{ ...ghostButtonStyle, color: "#F85149", borderColor: "#F85149" }}>
                🛠️ Admin
              </button>
            )}
            <button onClick={() => navigate("/dashboard")} style={ghostButtonStyle}>📊 Dashboard</button>
            <button onClick={() => navigate("/ai")} style={aiButtonStyle}>✨ AI Assistant</button>
            <button onClick={connectGithub} style={ghostButtonStyle}>🐙 Connect GitHub</button>
            <button onClick={logout} style={ghostButtonStyle}>Log out</button>
          </div>
        </div>

        {githubMessage && (
          <div role="status" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#161B22", border: `1px solid ${githubMessage.color}`, borderRadius: "8px", padding: "0.75rem 1rem", marginBottom: "1.5rem" }}>
            <span style={{ color: githubMessage.color, fontSize: "13px" }}>{githubMessage.text}</span>
            <button onClick={() => navigate("/projects", { replace: true })} aria-label="Dismiss" style={{ ...ghostButtonStyle, padding: "2px 8px" }}>✕</button>
          </div>
        )}

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

        {error && (
          <p role="alert" style={{ color: "#F85149", fontSize: "13px", marginBottom: "1rem" }}>{error}</p>
        )}

        {loading && <p style={{ color: "#8B949E", fontSize: "14px" }}>Loading projects...</p>}

        {!loading && !error && projects.length === 0 && (
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