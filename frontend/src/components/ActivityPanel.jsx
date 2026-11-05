import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { describeActivity, mergeActivity } from "../projects/activity";
import { formatMessageTime } from "../projects/chat";
import Button from "./ui/Button";
import Card from "./ui/Card";

const PAGE_SIZE = 20;

// refreshKey changes whenever the Board hears that something happened
function ActivityPanel({ projectId, refreshKey }) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const fetchPage = useCallback(
    (offset) => {
      return apiFetch(`/projects/${projectId}/activity?limit=${PAGE_SIZE}&offset=${offset}`).then((data) => {
        setEntries((prev) => mergeActivity(prev, data.activity ?? []));
        setTotal(data.total ?? 0);
        setError("");
      });
    },
    [projectId]
  );

  useEffect(() => {
    fetchPage(0)
      .catch((err) => setError(err.message))
      .finally(() => setLoaded(true));
  }, [fetchPage, refreshKey]);

  function loadMore() {
    setLoadingMore(true);
    fetchPage(entries.length)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingMore(false));
  }

  return (
    <section className="stack">
      <h2 className="section-title">📰 Activity</h2>
      <Card>
        {!loaded && <p role="status" className="muted small">Loading activity...</p>}
        {loaded && entries.length === 0 && !error && <p className="muted small">Nothing has happened here yet.</p>}
        {error && <p role="alert" className="small text-danger">{error}</p>}
        {entries.length > 0 && (
          <ul className="activity-list" aria-label="Project activity">
            {entries.map((entry) => (
              <li key={entry.id} className="small">
                <strong>{entry.username ?? "Deleted user"}</strong> {describeActivity(entry)}{" "}
                <time className="hint" dateTime={entry.created_at}>{formatMessageTime(entry.created_at)}</time>
              </li>
            ))}
          </ul>
        )}
        {entries.length < total && (
          <Button variant="link" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        )}
      </Card>
    </section>
  );
}

export default ActivityPanel;
