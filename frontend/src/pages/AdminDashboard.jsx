import { useState, useEffect } from "react";
import { apiFetch, apiFetchAll } from "../api/client";
import Alert from "../components/ui/Alert";
import BackLink from "../components/ui/BackLink";
import Card from "../components/ui/Card";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";

function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([apiFetch("/admin/stats"), apiFetchAll("/admin/users", "users"), apiFetchAll("/admin/projects", "projects")])
      .then(([statsData, allUsers, allProjects]) => {
        setStats(statsData);
        setUsers(allUsers);
        setProjects(allProjects);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <Page width={600}>
        <Alert>🚫 {error}</Alert>
        <BackLink to="/projects">Back to projects</BackLink>
      </Page>
    );
  }

  if (!stats) {
    return (
      <Page>
        <p role="status" className="muted">Loading...</p>
      </Page>
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
    <Page width={1000}>
      <BackLink to="/projects">All projects</BackLink>
      <PageHeader eyebrow="admin --platform-wide" title="Admin Dashboard" tone="danger" />

      <div className="grid-auto" style={{ "--min-col": "150px", marginBottom: "2.5rem" }}>
        {statCards.map((stat) => (
          <Card key={stat.label} className="stat">
            <div className="stat__value text-danger">{stat.value}</div>
            <div className="stat__label">{stat.label}</div>
          </Card>
        ))}
      </div>

      <div className="split">
        <section>
          <h2 className="section-title">👥 All Users ({users.length})</h2>
          <Card>
            {users.length === 0 && <p className="muted small">No users.</p>}
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, "--gap": "0.5rem" }}>
              {users.map((u) => (
                <li key={u.id} className="row row--between small">
                  <span>
                    {u.username} {u.is_admin && <span className="text-danger">(admin)</span>}
                  </span>
                  <span className="muted small">{u.project_count} projects</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <section>
          <h2 className="section-title">📁 All Projects ({projects.length})</h2>
          <Card>
            {projects.length === 0 && <p className="muted small">No projects.</p>}
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, "--gap": "0.5rem" }}>
              {projects.map((p) => (
                <li key={p.id} className="row row--between small">
                  <span>{p.name}</span>
                  <span className="muted small">
                    {p.owner_username} · {p.task_count} tasks
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </div>
    </Page>
  );
}

export default AdminDashboard;
