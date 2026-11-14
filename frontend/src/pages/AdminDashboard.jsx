import { useCallback, useEffect, useState } from "react";
import { CheckSquare, FileUp, FolderKanban, FolderOpen, MessageSquare, ShieldCheck, Users } from "lucide-react";
import { apiFetch, apiFetchAll } from "../api/client";
import Avatar from "../components/ui/Avatar";
import Badge from "../components/ui/Badge";
import Card from "../components/ui/Card";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Skeleton, { LoadingRegion, SkeletonText } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";

function AdminSkeleton() {
  return (
    <LoadingRegion label="Loading platform stats…">
      <div className="stats-grid" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <Card key={i} className="stat">
            <Skeleton width={32} height={32} radius={8} />
            <Skeleton width="40%" height={24} style={{ marginTop: "0.75rem" }} />
            <Skeleton width="60%" height={10} style={{ marginTop: "0.5rem" }} />
          </Card>
        ))}
      </div>
      <div className="split" aria-hidden="true">
        <Card><SkeletonText lines={5} /></Card>
        <Card><SkeletonText lines={5} /></Card>
      </div>
    </LoadingRegion>
  );
}

function AdminDashboard() {
  const [data, setData] = useState(null); // { stats, users, projects }
  const [error, setError] = useState("");

  const load = useCallback(() => {
    return Promise.all([apiFetch("/admin/stats"), apiFetchAll("/admin/users", "users"), apiFetchAll("/admin/projects", "projects")])
      .then(([stats, users, projects]) => {
        setData({ stats, users, projects });
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

  const header = <PageHeader title="Admin Dashboard" description="Platform-wide totals, every user and every project." />;

  if (error) {
    return (
      <Page width={1000}>
        {header}
        <ErrorState title="Couldn't load the admin data" message={error} onRetry={retry} />
      </Page>
    );
  }

  if (!data) {
    return (
      <Page width={1000}>
        {header}
        <AdminSkeleton />
      </Page>
    );
  }

  const { stats, users, projects } = data;
  const statCards = [
    { label: "Total Users", value: stats.total_users, Icon: Users },
    { label: "Total Projects", value: stats.total_projects, Icon: FolderKanban },
    { label: "Total Tasks", value: stats.total_tasks, Icon: CheckSquare },
    { label: "Total Files", value: stats.total_files, Icon: FileUp },
    { label: "Total Messages", value: stats.total_messages, Icon: MessageSquare },
  ];

  return (
    <Page width={1000}>
      {header}

      <ul className="stats-grid motion-stagger" aria-label="Platform totals">
        {statCards.map((stat, i) => (
          <li key={stat.label} style={{ "--i": i }}>
            <Card className="stat">
              <span className="stat__icon" aria-hidden="true"><stat.Icon size={16} /></span>
              <div className="stat__value">{stat.value.toLocaleString()}</div>
              <div className="stat__label">{stat.label}</div>
            </Card>
          </li>
        ))}
      </ul>

      <div className="split">
        <section>
          <h2 className="section-title section-title--icon"><Users size={18} aria-hidden="true" /> All Users ({users.length})</h2>
          <Card>
            {users.length === 0 ? (
              <EmptyState compact icon={<Users size={20} />} title="No users" headingLevel={3} />
            ) : (
              <ul className="admin-list">
                {users.map((u) => (
                  <li key={u.id} className="admin-list__row">
                    <Avatar name={u.username} size="sm" decorative />
                    <span className="admin-list__name">{u.username}</span>
                    {u.is_admin && <Badge tone="danger" icon={<ShieldCheck size={11} aria-hidden="true" />}>admin</Badge>}
                    <span className="muted small admin-list__meta">{u.project_count} projects</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section>
          <h2 className="section-title section-title--icon"><FolderOpen size={18} aria-hidden="true" /> All Projects ({projects.length})</h2>
          <Card>
            {projects.length === 0 ? (
              <EmptyState compact icon={<FolderOpen size={20} />} title="No projects" headingLevel={3} />
            ) : (
              <ul className="admin-list">
                {projects.map((p) => (
                  <li key={p.id} className="admin-list__row">
                    <span className="project-card__icon admin-list__icon" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
                    <span className="admin-list__name">{p.name}</span>
                    <span className="muted small admin-list__meta">
                      {p.owner_username} · {p.task_count} tasks
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </Page>
  );
}

export default AdminDashboard;
