import { useState, useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { apiFetch } from "../api/client";
import Alert from "../components/ui/Alert";
import BackLink from "../components/ui/BackLink";
import Card from "../components/ui/Card";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import { cssVar } from "../styles/tokens";
import { useTheme } from "../theme/useTheme";

function Dashboard() {
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState("");

  // Re-render on a theme change: the chart reads colours as literal values
  useTheme();

  useEffect(() => {
    apiFetch("/analytics")
      .then((data) => setAnalytics(data))
      .catch((err) => setError(err.message));
  }, []);

  const chartData = analytics
    ? [
        { name: "To Do", value: analytics.tasks_by_status.todo, color: cssVar("--color-text-muted", "#8b949e") },
        { name: "In Progress", value: analytics.tasks_by_status.in_progress, color: cssVar("--color-accent", "#58a6ff") },
        { name: "Done", value: analytics.tasks_by_status.done, color: cssVar("--color-success", "#7ee787") },
      ]
    : [];

  const stats = analytics
    ? [
        { label: "Projects", value: analytics.total_projects },
        { label: "Tasks", value: analytics.total_tasks },
        { label: "Files Uploaded", value: analytics.total_files },
        { label: "Chat Messages", value: analytics.total_messages },
      ]
    : [];

  return (
    <Page width={900}>
      <BackLink to="/projects">All projects</BackLink>
      <PageHeader eyebrow="stats --all" title="Analytics Dashboard" />

      {error && <Alert>Couldn&apos;t load analytics: {error}</Alert>}
      {!analytics && !error && <p role="status" className="muted">Loading...</p>}

      {analytics && (
        <>
          <div className="grid-auto" style={{ "--min-col": "160px", marginBottom: "2rem" }}>
            {stats.map((stat) => (
              <Card key={stat.label} className="stat">
                <div className="stat__value">{stat.value}</div>
                <div className="stat__label">{stat.label}</div>
              </Card>
            ))}
          </div>

          <Card>
            <h2 className="section-title">Tasks by Status</h2>
            {analytics.total_tasks === 0 ? (
              <p className="muted small">No tasks yet — create some to see this chart.</p>
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
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: cssVar("--color-bg"), border: `1px solid ${cssVar("--color-border")}`, color: cssVar("--color-text") }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}

export default Dashboard;
