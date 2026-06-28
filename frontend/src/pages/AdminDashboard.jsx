import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL;

function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/admin/stats`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_URL}/admin/users`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_URL}/admin/projects`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(async ([statsRes, usersRes, projectsRes]) => {
        if (!statsRes.ok) {
          throw new Error("Admin access required");
        }
        const statsData = await statsRes.json();
        const usersData = await usersRes.json();
        const projectsData = await projectsRes.json();
        setStats(statsData);
        setUsers(usersData.users);
        setProjects(projectsData.projects);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: "#0D1117", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#F85149", fontSize: "16px", marginBottom: "1rem" }}>🚫 {error}</p>
          <button onClick={() => navigate("/projects")} style={backButtonStyle}>← Back to projects</button>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div style={{ minHeight: "100vh", background: "#0D1117", color: "#8B949E", padding: "3rem" }}>
        Loading...
      </div>
    );
  }

  const statCards = [
    { label: "Total Users", value: stats.total_users },
    { label: "Total Projects", value: stats.total_projects },
    { label: "Total Tasks", value: stats.total_tasks },
    { label: "Total Files", value: stats.total_files },
    { label: "Total Messages", value: stats.total_messages },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0D1117", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "3rem 1.5rem" }}>
        <button onClick={() => navigate("/projects")} style={backButtonStyle}>← All projects</button>

        <div style={{ margin: "1rem 0 2rem" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", color: "#F85149", marginBottom: "0.3rem" }}>
            $ admin --platform-wide
          </div>
          <h1 style={{ fontFamily: "'JetBrains Mono', monospace", color: "#E6EDF3", fontSize: "24px", margin: 0, fontWeight: 600 }}>
            Admin Dashboard
          </h1>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "1rem", marginBottom: "2.5rem" }}>
          {statCards.map((stat) => (
            <div key={stat.label} style={statCardStyle}>
              <div style={{ color: "#F85149", fontSize: "24px", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                {stat.value}
              </div>
              <div style={{ color: "#8B949E", fontSize: "12px", marginTop: "0.3rem" }}>{stat.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "1.5rem" }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ color: "#E6EDF3", fontSize: "15px", fontWeight: 600, marginBottom: "1rem" }}>
              👥 All Users
            </h3>
            <div style={{ background: "#161B22", border: "1px solid #30363D", borderRadius: "10px", padding: "1rem" }}>
              {users.map((u) => (
                <div key={u.id} style={rowStyle}>
                  <span style={{ color: "#E6EDF3", fontSize: "13px" }}>
                    {u.username} {u.is_admin && <span style={{ color: "#F85149" }}>(admin)</span>}
                  </span>
                  <span style={{ color: "#8B949E", fontSize: "12px" }}>{u.project_count} projects</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <h3 style={{ color: "#E6EDF3", fontSize: "15px", fontWeight: 600, marginBottom: "1rem" }}>
              📁 All Projects
            </h3>
            <div style={{ background: "#161B22", border: "1px solid #30363D", borderRadius: "10px", padding: "1rem" }}>
              {projects.map((p) => (
                <div key={p.id} style={rowStyle}>
                  <span style={{ color: "#E6EDF3", fontSize: "13px" }}>{p.name}</span>
                  <span style={{ color: "#8B949E", fontSize: "12px" }}>
                    {p.owner_username} · {p.task_count} tasks
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const backButtonStyle = {
  padding: "0",
  background: "transparent",
  color: "#58A6FF",
  border: "none",
  fontSize: "13px",
  cursor: "pointer",
};

const statCardStyle = {
  background: "#161B22",
  border: "1px solid #30363D",
  borderRadius: "10px",
  padding: "1rem",
  textAlign: "center",
};

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid #21262D",
};

export default AdminDashboard;