import { useState } from "react";
import { apiFetch } from "../api/client";
import Button from "./ui/Button";
import Input from "./ui/Input";
import Modal from "./ui/Modal";

// Task details. Editors change them here; viewers see the same form read-only.
function TaskModal({ task, members, canEdit, onClose, onSaved }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [assigneeId, setAssigneeId] = useState(task.assignee_id == null ? "" : String(task.assignee_id));
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [priority, setPriority] = useState(task.priority ?? "medium");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function save(event) {
    event.preventDefault();
    if (!title.trim()) {
      setError("The title can't be empty.");
      return;
    }
    setSaving(true);
    setError("");
    apiFetch(`/tasks/${task.id}`, {
      method: "PATCH",
      body: {
        title: title.trim(),
        description: description.trim() || null,
        assignee_id: assigneeId === "" ? null : Number(assigneeId),
        due_date: dueDate || null,
        priority,
      },
    })
      .then(() => onSaved())
      .catch((err) => setError(err.message))
      .finally(() => setSaving(false));
  }

  return (
    <Modal title={canEdit ? "Edit task" : "Task details"} onClose={saving ? () => {} : onClose}>
      <form onSubmit={save} noValidate>
        <fieldset disabled={!canEdit} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          <Input label="Description" multiline rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
          <div className="field">
            <label htmlFor="task-assignee" className="field__label">Assignee</label>
            <select id="task-assignee" className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>{member.username}</option>
              ))}
            </select>
          </div>
          <div className="split" style={{ "--gap": "0.75rem" }}>
            <Input label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <div className="field">
              <label htmlFor="task-priority" className="field__label">Priority</label>
              <select id="task-priority" className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
        </fieldset>
        {error && <p role="alert" className="small text-danger" style={{ marginTop: "0.75rem" }}>{error}</p>}
        <div className="modal__actions">
          <Button variant="ghost" onClick={onClose} disabled={saving}>{canEdit ? "Cancel" : "Close"}</Button>
          {canEdit && <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>}
        </div>
      </form>
    </Modal>
  );
}

export default TaskModal;
