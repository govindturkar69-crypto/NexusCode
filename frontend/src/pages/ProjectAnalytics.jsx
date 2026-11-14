import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChartColumn, CheckCircle2, Clock, ListTodo, TriangleAlert } from "lucide-react";
import { apiFetch } from "../api/client";
import { useProject } from "../projects/useProject";
import Badge from "../components/ui/Badge";
import Card from "../components/ui/Card";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Skeleton, { LoadingRegion } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import "../styles/analytics.css";

const charts = () => import("../components/charts/ProjectCharts");
const BurnChart = lazy(() => charts().then((m) => ({ default: m.BurnChart })));
const ThroughputChart = lazy(() => charts().then((m) => ({ default: m.ThroughputChart })));
const ActivityChart = lazy(() => charts().then((m) => ({ default: m.ActivityChart })));

const RANGES = [7, 14, 30];

const days = (n) => (n === 1 ? "1 day" : `${n} days`);
const formatDays = (value) => (value < 1 ? `${Math.round(value * 24)} h` : `${value.toFixed(value < 10 ? 1 : 0)} days`);

function RangePicker({ value, onChange, disabled }) {
  return (
    <div className="segmented" role="group" aria-label="Date range">
      {RANGES.map((n) => (
        <button
          key={n}
          type="button"
          className={`segmented__option ${value === n ? "is-checked" : ""}`}
          aria-pressed={value === n}
          disabled={disabled}
          onClick={() => onChange(n)}
        >
          Last {n} days
        </button>
      ))}
    </div>
  );
}

// A chart with its title, a one-line summary for everyone, and the numbers as a table
function ChartFigure({ id, title, summary, columns, rows, children }) {
  return (
    <Card as="figure" className="chart-figure" aria-labelledby={`${id}-title`} aria-describedby={`${id}-summary`}>
      <figcaption>
        <h2 id={`${id}-title`} className="section-title">{title}</h2>
        <p id={`${id}-summary`} className="small muted chart-figure__summary">{summary}</p>
      </figcaption>
      <div aria-hidden="true">
        <Suspense fallback={<Skeleton height={220} />}>{children}</Suspense>
      </div>
      <details className="chart-figure__data">
        <summary>Show data</summary>
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">{title}</caption>
            <thead>
              <tr>{columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>{columns.map((c) => <td key={c.key}>{c.format ? c.format(row[c.key]) : row[c.key]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

function Stat({ icon, label, value, note, tone }) {
  return (
    <Card className={`stat ${tone ? `stat--${tone}` : ""}`}>
      <span className="stat__icon" aria-hidden="true">{icon}</span>
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
      {note && <p className="stat__note">{note}</p>}
    </Card>
  );
}

function AnalyticsSkeleton() {
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
      <div className="analytics-grid" aria-hidden="true">
        <Card><Skeleton height={300} /></Card>
        <Card><Skeleton height={300} /></Card>
      </div>
    </LoadingRegion>
  );
}

function ProjectAnalytics() {
  const { projectId } = useParams();
  const { project } = useProject(projectId);
  const [range, setRange] = useState(14);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [requested, setRequested] = useState(null); // `${projectId}:${range}`, to load once per pair

  const key = `${projectId}:${range}`;
  if (requested !== key) {
    // A new project or range: show the skeleton straight away (adjusted during render)
    setRequested(key);
    setLoading(true);
    setError("");
  }

  const load = useCallback(() => {
    let cancelled = false;
    apiFetch(`/projects/${projectId}/analytics?range=${range}`)
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, range]);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => load(), [load, attempt]);

  function retry() {
    setError("");
    setLoading(true);
    setAttempt((n) => n + 1);
  }

  const header = (
    <PageHeader
      title="Analytics"
      description={project ? `How ${project.name} is going.` : "How this project is going."}
      actions={<RangePicker value={range} onChange={setRange} disabled={loading && !data} />}
    />
  );

  if (error && !data) {
    return (
      <Page width={1120}>
        {header}
        <ErrorState title="Couldn't load analytics" message={error} onRetry={retry} />
      </Page>
    );
  }
  if (!data || (loading && data.range_days !== range)) {
    return (
      <Page width={1120}>
        {header}
        <AnalyticsSkeleton />
      </Page>
    );
  }

  const quiet = data.total_tasks === 0 && data.activity_by_day.every((d) => d.events === 0);
  const done = data.tasks_by_status.done;
  const open = data.tasks_by_status.todo + data.tasks_by_status.in_progress;
  const finishedInRange = data.throughput.reduce((sum, b) => sum + b.completed, 0);
  const last = data.burn[data.burn.length - 1] ?? { date: data.end_date, scope: 0, completed: 0, remaining: 0 };
  const totalEvents = data.activity_by_day.reduce((sum, d) => sum + d.events, 0);
  const maxLoad = Math.max(1, ...data.workload.map((w) => w.todo + w.in_progress + w.done));

  return (
    <Page width={1120}>
      {header}
      {error && <p role="alert" className="small text-danger">Couldn&apos;t refresh: {error}</p>}

      {quiet ? (
        <EmptyState icon={<ChartColumn size={26} />} title="Not much to show yet" action={<Link className="btn btn--primary" to={`/projects/${projectId}`}>Go to the board</Link>}>
          Add tasks and move them across the board: this page charts progress, throughput and who&apos;s working on what.
        </EmptyState>
      ) : (
        <div className={`analytics motion-fade-in ${loading ? "is-refreshing" : ""}`} aria-busy={loading}>
          <ul className="stats-grid motion-stagger" aria-label="Summary">
            <li style={{ "--i": 0 }}><Stat icon={<ListTodo size={16} />} label="Open tasks" value={open} note={`${data.total_tasks} in total`} /></li>
            <li style={{ "--i": 1 }}><Stat icon={<CheckCircle2 size={16} />} label={`Finished in the last ${days(data.range_days)}`} value={finishedInRange} note={`${done} done in total`} tone="success" /></li>
            <li style={{ "--i": 2 }}>
              <Stat
                icon={<Clock size={16} />}
                label="Cycle time (median)"
                value={data.cycle_time.available ? formatDays(data.cycle_time.median_days) : "—"}
                note={data.cycle_time.available ? `90% within ${formatDays(data.cycle_time.p90_days)} · ${data.cycle_time.sample_size} task${data.cycle_time.sample_size === 1 ? "" : "s"}` : data.cycle_time.reason}
              />
            </li>
            <li style={{ "--i": 3 }}><Stat icon={<TriangleAlert size={16} />} label="Overdue" value={data.overdue.count} note={data.overdue.count ? "Open past their due date" : "Nothing overdue"} tone={data.overdue.count ? "danger" : undefined} /></li>
          </ul>

          {data.completion_dates.undated > 0 && (
            <p className="small muted analytics__note" role="note">
              {data.completion_dates.undated} done task{data.completion_dates.undated === 1 ? " has" : "s have"} no recorded completion time
              (created as done, renamed after finishing, or sharing a title), so {data.completion_dates.undated === 1 ? "it is" : "they are"} left out of the charts over time.
            </p>
          )}

          <div className="analytics-grid">
            <ChartFigure
              id="burn"
              title="Burn-up and burn-down"
              summary={`On ${last.date}: ${last.scope} tasks in scope, ${last.completed} completed, ${last.remaining} remaining.`}
              columns={[{ key: "date", label: "Day" }, { key: "scope", label: "Scope" }, { key: "completed", label: "Completed" }, { key: "remaining", label: "Remaining" }]}
              rows={data.burn}
            >
              <BurnChart data={data.burn} />
            </ChartFigure>
            <ChartFigure
              id="throughput"
              title="Throughput"
              summary={`${finishedInRange} task${finishedInRange === 1 ? "" : "s"} finished, in 7-day blocks.`}
              columns={[{ key: "start", label: "From" }, { key: "end", label: "To" }, { key: "completed", label: "Finished" }]}
              rows={data.throughput}
            >
              <ThroughputChart data={data.throughput} />
            </ChartFigure>
          </div>

          <div className="analytics-grid">
            <Card as="section" aria-labelledby="workload-title">
              <h2 id="workload-title" className="section-title">Workload</h2>
              {data.workload.length === 0 ? (
                <p className="small muted">No tasks yet.</p>
              ) : (
                <ul className="workload" aria-label="Tasks per person">
                  {data.workload.map((w) => {
                    const total = w.todo + w.in_progress + w.done;
                    const name = w.username ?? "Unassigned";
                    return (
                      <li key={w.user_id ?? "none"} className="workload__row">
                        <span className="workload__name">{w.username ? `@${w.username}` : <em>Unassigned</em>}</span>
                        <span className="workload__bar" aria-hidden="true" style={{ "--w": `${(total / maxLoad) * 100}%` }}>
                          <span className="workload__seg workload__seg--todo" style={{ flexGrow: w.todo }} />
                          <span className="workload__seg workload__seg--progress" style={{ flexGrow: w.in_progress }} />
                          <span className="workload__seg workload__seg--done" style={{ flexGrow: w.done }} />
                        </span>
                        <span className="workload__counts small" aria-label={`${name}: ${w.todo} to do, ${w.in_progress} in progress, ${w.done} done`}>
                          {w.todo} · {w.in_progress} · {w.done}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="small muted workload__legend" aria-hidden="true">
                <span className="workload__key workload__seg--todo" /> To do
                <span className="workload__key workload__seg--progress" /> In progress
                <span className="workload__key workload__seg--done" /> Done
              </p>
            </Card>

            <Card as="section" aria-labelledby="overdue-title">
              <h2 id="overdue-title" className="section-title">Overdue</h2>
              {data.overdue.tasks.length === 0 ? (
                <p className="small muted">Nothing is overdue.</p>
              ) : (
                <ul className="analytics-list">
                  {data.overdue.tasks.map((t) => (
                    <li key={t.id}>
                      <span className="analytics-list__main">{t.title}</span>
                      <Badge tone="danger">{days(t.days_overdue)} late</Badge>
                      <span className="small muted">{t.assignee ? `@${t.assignee}` : "Unassigned"}</span>
                    </li>
                  ))}
                  {data.overdue.count > data.overdue.tasks.length && (
                    <li className="small muted">and {data.overdue.count - data.overdue.tasks.length} more</li>
                  )}
                </ul>
              )}
            </Card>
          </div>

          <div className="analytics-grid analytics-grid--wide-first">
            <ChartFigure
              id="activity"
              title="Activity"
              summary={`${totalEvents} event${totalEvents === 1 ? "" : "s"} in the feed over the last ${days(data.range_days)}.`}
              columns={[{ key: "date", label: "Day" }, { key: "events", label: "Events" }]}
              rows={data.activity_by_day}
            >
              <ActivityChart data={data.activity_by_day} />
            </ChartFigure>
            <Card as="section" aria-labelledby="people-title">
              <h2 id="people-title" className="section-title">Most active</h2>
              {data.contributors.length === 0 ? (
                <p className="small muted">No activity in this range.</p>
              ) : (
                <ol className="analytics-list">
                  {data.contributors.map((c) => (
                    <li key={c.username}><span className="analytics-list__main">@{c.username}</span><span className="small muted">{c.events} event{c.events === 1 ? "" : "s"}</span></li>
                  ))}
                </ol>
              )}
              <h3 className="analytics-subtitle">Files edited ({data.files_edited})</h3>
              {data.recent_files.length === 0 ? (
                <p className="small muted">No code edited in this range.</p>
              ) : (
                <ul className="analytics-list">
                  {data.recent_files.map((f) => (
                    <li key={f.path}><span className="analytics-list__main mono">{f.path}</span><span className="small muted">{new Date(f.updated_at).toLocaleDateString()}</span></li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <p className="small muted analytics__note">Days are UTC calendar days. Completion times come from moves to Done in the activity feed.</p>
        </div>
      )}
    </Page>
  );
}

export default ProjectAnalytics;
