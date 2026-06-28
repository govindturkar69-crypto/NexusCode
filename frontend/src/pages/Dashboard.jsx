import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

const API_URL = import.meta.env.VITE_API_URL;

function Dashboard() {
  const [analytics, setAnalytics] = useState(null);
  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  useEffect(() => {
    fetch(`${API_URL}/analytics`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => setAnalytics(data));
  }, []);

  if (!analytics) {
    return (
      <div style={{ minHeight: "100vh", background: "#0D1117", color: "#8B949E", padding: "3rem" }}>
        Loading...
      </div>
    );
  }

  const chartData = [
    { name: "To Do", value: analytics.tasks_by_status.todo, color: "#8B949E" },
    { name: "In Progress", value: analytics.tasks_by_status.in_progress, color: "#58A6FF" },
    { name: "Done", value: analytics.tasks_by_status.done, color: "#7EE787" },
  ];

  const stats = [
    { label: "Projects", value: analytics.total_projects },
    { label: "Tasks", value: analytics.total_tasks },
    { label: "Files Uploaded", value: analytics.total_files },
    { label: "Chat Messages", value: analytics.total_messages },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0D1117", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "3rem 1.5rem" }}>
        <button onClick={() => navigate("/projects")} style={backButtonStyle}>← All projects</button>

        <div style={{ margin: "1rem 0 2rem" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", color: "#58A6FF", marginBottom: "0.3rem" }}>
            $ stats --all
          </div>
          <h1 style={{ fontFamily: "'JetBrains Mono', monospace", color: "#E6EDF3", fontSize: "24px", margin: 0, fontWeight: 600 }}>
            Analytics Dashboard
          </h1>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "2rem" }}>
          {stats.map((stat) => (
            <div key={stat.label} style={statCardStyle}>
              <div style={{ color: "#58A6FF", fontSize: "28px", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                {stat.value}
              </div>
              <div style={{ color: "#8B949E", fontSize: "13px", marginTop: "0.3rem" }}>{stat.label}</div>
            </div>
          ))}
        </div>

        <div style={{ background: "#161B22", border: "1px solid #30363D", borderRadius: "10px", padding: "1.5rem" }}>
          <h3 style={{ color: "#E6EDF3", fontSize: "15px", fontWeight: 600, marginTop: 0, marginBottom: "1rem" }}>
            Tasks by Status
          </h3>

          {analytics.total_tasks === 0 ? (
            <p style={{ color: "#8B949E", fontSize: "13px" }}>No tasks yet — create some to see this chart.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ name, value }) => (value > 0 ? `${name}: ${value}` : "")}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#0D1117", border: "1px solid #30363D" }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
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
  padding: "1.25rem",
  textAlign: "center",
};

export default Dashboard;