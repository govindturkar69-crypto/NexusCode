import { useCallback, useEffect, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { CheckSquare, FileUp, FolderKanban, MessageSquare, PieChart as PieIcon } from "lucide-react";
import { apiFetch } from "../api/client";
import Card from "../components/ui/Card";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Skeleton, { LoadingRegion } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { cssVar } from "../styles/tokens";
import { useTheme } from "../theme/useTheme";

function DashboardSkeleton() {
  return (
    <LoadingRegion label="Loading analytics…">
      <div className="stats-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="stat">
            <Skeleton width={32} height={32} radius={8} />
            <Skeleton width="40%" height={24} style={{ marginTop: "0.75rem" }} />
            <Skeleton width="60%" height={10} style={{ marginTop: "0.5rem" }} />
          </Card>
        ))}
      </div>
      <Card aria-hidden="true"><Skeleton height={300} /></Card>
    </LoadingRegion>
  );
}

function Dashboard() {
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState("");

  // Re-render on a theme change: the chart reads colours as literal values
  useTheme();

  const load = useCallback(() => {
    return apiFetch("/analytics")
      .then((data) => {
        setAnalytics(data);
        setError("");
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function retry() {
    setError("");
    load();
  }

  const chartData = analytics
    ? [
        { name: "To Do", value: analytics.tasks_by_status.todo, color: cssVar("--color-text-subtle", "#8b949e") },
        { name: "In Progress", value: analytics.tasks_by_status.in_progress, color: cssVar("--color-accent", "#58a6ff") },
        { name: "Done", value: analytics.tasks_by_status.done, color: cssVar("--color-success", "#7ee787") },
      ]
    : [];

  const stats = analytics
    ? [
        { label: "Projects", value: analytics.total_projects, Icon: FolderKanban },
        { label: "Tasks", value: analytics.total_tasks, Icon: CheckSquare },
        { label: "Files Uploaded", value: analytics.total_files, Icon: FileUp },
        { label: "Chat Messages", value: analytics.total_messages, Icon: MessageSquare },
      ]
    : [];

  return (
    <Page width={960}>
      <PageHeader title="Analytics Dashboard" description="Totals across every project you're a member of." />

      {error && <ErrorState title="Couldn't load analytics" message={error} onRetry={retry} />}
      {!analytics && !error && <DashboardSkeleton />}

      {analytics && !error && (
        <>
          <ul className="stats-grid motion-stagger" aria-label="Totals">
            {stats.map((stat, i) => (
              <li key={stat.label} style={{ "--i": i }}>
                <Card className="stat">
                  <span className="stat__icon" aria-hidden="true"><stat.Icon size={16} /></span>
                  <div className="stat__value">{stat.value.toLocaleString()}</div>
                  <div className="stat__label">{stat.label}</div>
                </Card>
              </li>
            ))}
          </ul>

          <Card className="motion-rise-in">
            <h2 className="section-title">Tasks by Status</h2>
            {analytics.total_tasks === 0 ? (
              <EmptyState compact icon={<PieIcon size={20} />} title="No tasks yet" headingLevel={3}>
                No tasks yet — create some to see this chart.
              </EmptyState>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={62}
                    outerRadius={100}
                    paddingAngle={2}
                    stroke={cssVar("--color-surface", "#151b23")}
                    label={({ name, value }) => (value > 0 ? `${name}: ${value}` : "")}
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: cssVar("--color-surface-raised"), border: `1px solid ${cssVar("--color-border")}`, borderRadius: 8, color: cssVar("--color-text") }} />
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
