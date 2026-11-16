import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight, Calendar, CheckSquare, CodeXml, FileUp, Flag, FolderKanban, FolderPlus, Keyboard, MessageSquare, PieChart as PieIcon, Search, SquareKanban } from "lucide-react";
import { apiFetch, apiFetchAll } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { describeActivity } from "../projects/activity";
import { combinedActivity, greeting, myOpenTasks, orderProjects, recentProjectIds } from "../projects/home";
import { isOverdue } from "../projects/tasks";
import { relativeTime } from "../utils/time";
import Avatar from "../components/ui/Avatar";
import Badge from "../components/ui/Badge";
import Card from "../components/ui/Card";
import Kbd from "../components/ui/Kbd";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import RoleBadge from "../components/RoleBadge";
import Skeleton, { LoadingRegion } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";

import "../styles/home.css";

const TaskStatusChart = lazy(() => import("../components/charts/TaskStatusChart"));

// Tasks and activity come from the projects you opened most recently
const PROJECTS_SCANNED = 6;
const PRIORITY_TONE = { low: "neutral", medium: "accent", high: "danger" };

// Opens the command palette or the shortcuts overlay the same way the keyboard does
function pressKey(init) {
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
}

function SectionSkeleton({ rows = 3 }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="home-row">
          <Skeleton width={28} height={28} radius={14} />
          <div className="grow"><Skeleton width="70%" height={12} /><Skeleton width="40%" height={10} style={{ marginTop: 6 }} /></div>
        </div>
      ))}
    </div>
  );
}

function QuickActions() {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return (
    <ul className="quick-actions" aria-label="Quick actions">
      <li>
        <Link to="/projects?do=new-project" className="quick-action">
          <FolderPlus size={18} aria-hidden="true" />
          <span>New project</span>
        </Link>
      </li>
      <li>
        <button type="button" className="quick-action" onClick={() => pressKey({ key: "k", ctrlKey: !isMac, metaKey: isMac })}>
          <Search size={18} aria-hidden="true" />
          <span>Search everything</span>
          <Kbd keys={["Mod", "K"]} className="quick-action__kbd" />
        </button>
      </li>
      <li>
        <button type="button" className="quick-action" onClick={() => pressKey({ key: "?" })}>
          <Keyboard size={18} aria-hidden="true" />
          <span>Keyboard shortcuts</span>
          <Kbd keys={["?"]} className="quick-action__kbd" />
        </button>
      </li>
    </ul>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState(null);
  const [projects, setProjects] = useState(null);
  const [work, setWork] = useState(null); // { tasks, activity }
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const totals = apiFetch("/analytics").then(setAnalytics);
    const lists = apiFetchAll("/projects", "projects").then((all) => {
      const ordered = orderProjects(all, recentProjectIds(user?.username));
      setProjects(ordered);
      const scanned = ordered.slice(0, PROJECTS_SCANNED);
      // One project failing (e.g. just removed from it) doesn't blank the rest
      return Promise.all(
        scanned.map((project) =>
          Promise.all([
            apiFetchAll(`/projects/${project.id}/tasks`, "tasks").catch(() => []),
            apiFetch(`/projects/${project.id}/activity?limit=8`).then((d) => d.activity ?? []).catch(() => []),
          ]).then(([tasks, activity]) => ({ project, tasks, activity })),
        ),
      ).then((perProject) => setWork({ perProject }));
    });
    return Promise.all([totals, lists])
      .then(() => setError(""))
      .catch((err) => setError(err.message));
  }, [user?.username]);

  useEffect(() => {
    load();
  }, [load]);

  function retry() {
    setError("");
    load();
  }

  const myTasks = work && user ? myOpenTasks(work.perProject, user.id).slice(0, 8) : null;
  const feed = work ? combinedActivity(work.perProject, 8) : null;
  const firstRun = projects !== null && projects.length === 0;

  const stats = analytics
    ? [
        { label: "Projects", value: analytics.total_projects, Icon: FolderKanban },
        { label: "Tasks", value: analytics.total_tasks, Icon: CheckSquare },
        { label: "Files uploaded", value: analytics.total_files, Icon: FileUp },
        { label: "Chat messages", value: analytics.total_messages, Icon: MessageSquare },
      ]
    : [];

  return (
    <Page width={1120}>
      <PageHeader
        title={user ? `${greeting()}, ${user.username}` : "Dashboard"}
        description="What's assigned to you, what changed, and where you left off."
      />

      {error && <ErrorState title="Couldn't load your dashboard" message={error} onRetry={retry} />}

      <QuickActions />

      {firstRun && !error && (
        <Card className="motion-rise-in">
          <EmptyState icon={<FolderPlus size={26} />} title="Start with a project" action={<Link to="/projects?do=new-project" className="btn btn--primary">Create a project</Link>}>
            A project gives you a Kanban board, chat, files, a shared code editor and video meetings. Your tasks and the team's activity will show up here.
          </EmptyState>
        </Card>
      )}

      {!firstRun && (
        <div className="home-grid">
          <section className="home-panel" aria-labelledby="home-tasks">
            <div className="home-panel__head">
              <h2 id="home-tasks" className="section-title"><CheckSquare size={17} aria-hidden="true" /> Assigned to you</h2>
              {myTasks && <span className="home-panel__count">{myTasks.length}</span>}
            </div>
            <Card>
              {myTasks === null ? (
                <LoadingRegion label="Loading your tasks…"><SectionSkeleton /></LoadingRegion>
              ) : myTasks.length === 0 ? (
                <EmptyState compact headingLevel={3} icon={<CheckSquare size={20} />} title="Nothing assigned to you">
                  Open tasks assigned to you, from your recent projects, show up here.
                </EmptyState>
              ) : (
                <ul className="home-list motion-stagger">
                  {myTasks.map((task, i) => {
                    const overdue = isOverdue(task);
                    return (
                      <li key={task.id} style={{ "--i": i }}>
                        <Link to={`/projects/${task.project.id}?do=task&task=${task.id}`} className="home-row home-row--link">
                          <span className={`home-row__status home-row__status--${task.status}`} aria-hidden="true" />
                          <span className="home-row__main">
                            <span className="home-row__title">{task.title}</span>
                            <span className="home-row__meta">{task.project.name}</span>
                          </span>
                          <span className="home-row__chips">
                            <Badge tone={PRIORITY_TONE[task.priority] ?? "neutral"} icon={<Flag size={11} aria-hidden="true" />}>{task.priority}</Badge>
                            {task.due_date && (
                              <Badge tone={overdue ? "danger" : "neutral"} icon={<Calendar size={11} aria-hidden="true" />}>{overdue ? `Overdue ${task.due_date}` : task.due_date}</Badge>
                            )}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </section>

          <section className="home-panel" aria-labelledby="home-activity">
            <div className="home-panel__head">
              <h2 id="home-activity" className="section-title"><Activity size={17} aria-hidden="true" /> Recent activity</h2>
            </div>
            <Card>
              {feed === null ? (
                <LoadingRegion label="Loading activity…"><SectionSkeleton rows={4} /></LoadingRegion>
              ) : feed.length === 0 ? (
                <EmptyState compact headingLevel={3} icon={<Activity size={20} />} title="No activity yet">
                  Changes to tasks, files and code in your projects appear here.
                </EmptyState>
              ) : (
                <ul className="home-list motion-stagger">
                  {feed.map((entry, i) => (
                    <li key={`${entry.project.id}-${entry.id}`} className="home-row" style={{ "--i": i }}>
                      <Avatar name={entry.username ?? "?"} size="sm" decorative />
                      <span className="home-row__main">
                        <span className="home-row__title home-row__title--wrap"><strong>{entry.username ?? "Someone"}</strong> {describeActivity(entry)}</span>
                        <span className="home-row__meta">
                          <Link to={`/projects/${entry.project.id}`}>{entry.project.name}</Link> · <time dateTime={entry.created_at}>{relativeTime(entry.created_at)}</time>
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <section className="home-panel home-panel--wide" aria-labelledby="home-projects">
            <div className="home-panel__head">
              <h2 id="home-projects" className="section-title"><FolderKanban size={17} aria-hidden="true" /> Recent projects</h2>
              <Link to="/projects" className="btn btn--link">All projects <ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
            {projects === null ? (
              <LoadingRegion label="Loading projects…" className="home-projects">
                {[0, 1, 2].map((i) => <Card key={i} aria-hidden="true"><Skeleton width="60%" height={14} /><Skeleton width="30%" height={10} style={{ marginTop: 10 }} /></Card>)}
              </LoadingRegion>
            ) : (
              <ul className="home-projects motion-stagger">
                {projects.slice(0, 4).map((project, i) => (
                  <li key={project.id} style={{ "--i": i }}>
                    <Card className="home-project">
                      <div className="home-project__top">
                        <span className="project-switcher__avatar" aria-hidden="true">{project.name.slice(0, 1).toUpperCase()}</span>
                        <Link to={`/projects/${project.id}`} className="home-project__name">{project.name}</Link>
                        <RoleBadge role={project.role} />
                      </div>
                      <div className="home-project__links">
                        <Link to={`/projects/${project.id}`} className="btn btn--subtle btn--sm"><SquareKanban size={14} aria-hidden="true" /> Board</Link>
                        <Link to={`/projects/${project.id}/editor`} className="btn btn--subtle btn--sm"><CodeXml size={14} aria-hidden="true" /> Editor</Link>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <section className="home-panel" aria-labelledby="home-totals">
        <h2 id="home-totals" className="section-title"><PieIcon size={17} aria-hidden="true" /> Across all your projects</h2>
        {!analytics && !error && (
          <LoadingRegion label="Loading totals…">
            <div className="stats-grid" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => <Card key={i} className="stat"><Skeleton width={32} height={32} radius={8} /><Skeleton width="40%" height={24} style={{ marginTop: "0.75rem" }} /></Card>)}
            </div>
          </LoadingRegion>
        )}
        {analytics && (
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
            {analytics.total_tasks > 0 && (
              <Card>
                <h3 className="section-title">Tasks by status</h3>
                <Suspense fallback={<Skeleton height={300} />}>
                  <TaskStatusChart byStatus={analytics.tasks_by_status} />
                </Suspense>
              </Card>
            )}
          </>
        )}
      </section>
    </Page>
  );
}

export default Dashboard;
