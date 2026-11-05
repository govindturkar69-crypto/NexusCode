import { useState } from "react";
import { apiFetch } from "../api/client";
import Button from "./ui/Button";
import Input from "./ui/Input";
import Modal from "./ui/Modal";

// Matches the backend limit
const MAX_DESCRIPTION_CHARS = 4000;

// Nothing is added until the user reviews the list and presses Add.
function TaskSuggestDialog({ projectId, onClose, onAdded }) {
  const [description, setDescription] = useState("");
  const [tasks, setTasks] = useState(null); // proposals, once they arrive
  const [selected, setSelected] = useState(() => new Set());
  const [generating, setGenerating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const busy = generating || adding;

  function generate(event) {
    event.preventDefault();
    if (!description.trim()) return;
    setGenerating(true);
    setError("");
    apiFetch(`/ai/projects/${projectId}/task-suggestions`, { method: "POST", body: { description } })
      .then((data) => {
        setTasks(data.tasks);
        setSelected(new Set(data.tasks.map((_, index) => index)));
      })
      .catch((err) => setError(err.message))
      .finally(() => setGenerating(false));
  }

  function toggle(index) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function addSelected() {
    setAdding(true);
    setError("");
    const indexes = [...selected].sort((a, b) => a - b);
    // One at a time, in order, so a failure can say exactly what's left
    let added = 0;
    for (const index of indexes) {
      try {
        await apiFetch(`/projects/${projectId}/tasks`, { method: "POST", body: tasks[index] });
        added += 1;
      } catch (err) {
        const addedIndexes = new Set(indexes.slice(0, added));
        setTasks((prev) => prev.filter((_, i) => !addedIndexes.has(i)));
        setSelected(new Set(indexes.slice(added).map((i) => i - added)));
        setError(`Added ${added} of ${indexes.length}. ${err.message}`);
        setAdding(false);
        if (added > 0) onAdded(false);
        return;
      }
    }
    onAdded(true);
  }

  return (
    <Modal title="Generate tasks from a description" onClose={busy ? () => {} : onClose}>
      {tasks === null ? (
        <form onSubmit={generate} className="stack" noValidate>
          <Input
            label="What are you building?"
            multiline
            rows={5}
            maxLength={MAX_DESCRIPTION_CHARS}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Users can reset a forgotten password by email"
            hint="The AI proposes tasks. You choose which ones to add."
          />
          {error && <p role="alert" className="small text-danger">{error}</p>}
          <div className="modal__actions">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !description.trim()}>{generating ? "Thinking..." : "✨ Generate"}</Button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <p className="muted small">These haven&apos;t been added. Untick any you don&apos;t want.</p>
          <ul className="task-suggestions">
            {tasks.map((task, index) => (
              <li key={`${index}-${task.title}`}>
                <label className="task-suggestions__item">
                  <input type="checkbox" checked={selected.has(index)} onChange={() => toggle(index)} disabled={adding} />
                  <span className="grow">
                    <strong className="small">{task.title}</strong>{" "}
                    <span className={`badge badge--priority-${task.priority}`}>{task.priority}</span>
                    {task.description && <span className="hint" style={{ display: "block" }}>{task.description}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="small text-danger">{error}</p>}
          <div className="modal__actions">
            <Button variant="ghost" onClick={() => { setTasks(null); setError(""); }} disabled={adding}>Back</Button>
            <Button variant="ghost" onClick={onClose} disabled={adding}>Cancel</Button>
            <Button onClick={addSelected} disabled={adding || selected.size === 0}>
              {adding ? "Adding..." : `Add ${selected.size} task${selected.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default TaskSuggestDialog;
