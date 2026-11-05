import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { apiFetch, apiFetchAll } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useProject } from "../projects/useProject";
import { filterByAssignee, isOverdue, moveTask } from "../projects/tasks";
import ActivityPanel from "../components/ActivityPanel";
import ChatPanel from "../components/ChatPanel";
import TaskModal from "../components/TaskModal";
import TaskSuggestDialog from "../components/TaskSuggestDialog";
import MembersPanel from "../components/MembersPanel";
import RoleBadge from "../components/RoleBadge";
import Alert from "../components/ui/Alert";
import BackLink from "../components/ui/BackLink";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Input from "../components/ui/Input";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";

// Mirrors the backend allowlist (app/services/storage.py); the server still validates
const UPLOAD_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.zip,.txt,.md,.csv,.json,.log,.py,.js,.jsx,.ts,.tsx,.java,.c,.cpp,.h,.css,.sql,.yml,.yaml,.toml,.ini";

const COLUMNS = [
  { status: "todo", title: "To Do", dot: "var(--color-text-muted)" },
  { status: "in_progress", title: "In Progress", dot: "var(--color-accent)" },
  { status: "done", title: "Done", dot: "var(--color-success)" },
];

function Board() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { project, role, canEdit, isOwner, error: projectError, reload: reloadProject } = useProject(projectId);
  const [members, setMembers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState([]);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [toDelete, setToDelete] = useState(null); // { kind: "task" | "file", id, name }
  const [deleting, setDeleting] = useState(false);
  const [activityVersion, setActivityVersion] = useState(0);

  const fetchTasks = useCallback(() => {
    return apiFetchAll(`/projects/${projectId}/tasks`, "tasks")
      .then(setTasks)
      .catch((err) => setError(err.message))
      .finally(() => setTasksLoaded(true));
  }, [projectId]);

  const fetchFiles = useCallback(() => {
    return apiFetchAll(`/projects/${projectId}/files`, "files")
      .then(setFiles)
      .catch((err) => setError(err.message))
      .finally(() => setFilesLoaded(true));
  }, [projectId]);

  const fetchMembers = useCallback(() => {
    return apiFetch(`/projects/${projectId}/members`)
      .then((data) => setMembers(data.members ?? []))
      .catch((err) => setError(err.message));
  }, [projectId]);

  useEffect(() => {
    fetchMembers();
    fetchTasks();
    fetchFiles();
  }, [projectId, fetchMembers, fetchTasks, fetchFiles]);

  // Someone (maybe us, in another tab) changed the project: show it right away
  const handleActivity = useCallback(({ action }) => {
    setActivityVersion((version) => version + 1);
    if (action.startsWith("task_")) fetchTasks();
    else if (action.startsWith("file_")) fetchFiles();
    else if (action.startsWith("member_") || action === "role_changed") {
      fetchMembers();
      fetchTasks();
      reloadProject();
    }
  }, [fetchTasks, fetchFiles, fetchMembers, reloadProject]);

  function createTask(event) {
    event.preventDefault();
    if (!title.trim()) return;
    setError("");
    apiFetch(`/projects/${projectId}/tasks`, { method: "POST", body: { title: title.trim() } })
      .then(() => {
        setTitle("");
        return fetchTasks();
      })
      .catch((err) => setError(err.message));
  }

  function uploadFile(e) {
    const selectedFile = e.target.files[0];
    e.target.value = "";
    if (!selectedFile) return;

    const form = new FormData();
    form.append("file", selectedFile);

    setError("");
    setUploading(true);
    apiFetch(`/projects/${projectId}/files`, { method: "POST", form })
      .then(() => fetchFiles())
      .catch((err) => setError(err.message))
      .finally(() => setUploading(false));
  }

  function confirmDelete() {
    const { kind, id } = toDelete;
    setDeleting(true);
    setError("");
    apiFetch(kind === "task" ? `/tasks/${id}` : `/files/${id}`, { method: "DELETE" })
      .then(() => (kind === "task" ? fetchTasks() : fetchFiles()))
      .catch((err) => setError(err.message))
      .finally(() => {
        setDeleting(false);
        setToDelete(null);
      });
  }

  function handleDragEnd(result) {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;
    const taskId = Number(draggableId);
    const status = destination.droppableId;
    setTasks((prev) => moveTask(prev, taskId, status, destination.index));
    // Always resync afterwards: on failure this undoes the optimistic move
    apiFetch(`/tasks/${taskId}/move`, { method: "PATCH", body: { status, index: destination.index } })
      .catch((err) => setError(err.message))
      .finally(() => fetchTasks());
  }

  const filtering = assigneeFilter !== "";
  const visibleTasks = filterByAssignee(tasks, assigneeFilter);

  return (
    <Page width={1100}>
      <div className="row">
        <BackLink to="/projects">All projects</BackLink>
        <Link className="btn btn--link" to={`/projects/${projectId}/editor`}>💻 Open Code Editor</Link>
        <Link className="btn btn--link" to={`/projects/${projectId}/meeting`}>📹 Start Meeting</Link>
      </div>
      <PageHeader eyebrow={`board --project ${projectId}`} title={project?.name ?? "Project Board"} actions={role && <RoleBadge role={role} />} />

      <Alert onDismiss={() => setError("")}>{error}</Alert>
      {projectError && <Alert>{projectError}</Alert>}

      {role === "viewer" && (
        <Alert tone="info">You have view-only access to this project. Ask an owner if you need to make changes.</Alert>
      )}

      {canEdit && (
        <Card as="form" onSubmit={createTask} className="row" style={{ marginBottom: "2rem" }}>
          <Input label="New task title" hideLabel placeholder="New task title" value={title} onChange={(e) => setTitle(e.target.value)} className="grow" />
          <Button type="submit" disabled={!title.trim()}>+ Add Task</Button>
          <Button variant="ghost" onClick={() => setSuggesting(true)}>✨ Generate tasks</Button>
        </Card>
      )}

      <div className="row" style={{ marginBottom: "1rem" }}>
        <label htmlFor="assignee-filter" className="muted small">Assignee</label>
        <select id="assignee-filter" className="input input--sm" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
          <option value="">Everyone</option>
          <option value="unassigned">Unassigned</option>
          {members.map((member) => (
            <option key={member.user_id} value={member.user_id}>{member.username}</option>
          ))}
        </select>
        {filtering && canEdit && <span className="hint" style={{ margin: 0 }}>Clear the filter to drag tasks.</span>}
      </div>

      {!tasksLoaded && <p role="status" className="muted">Loading tasks...</p>}

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="kanban">
          {COLUMNS.map(({ status, title: columnTitle, dot }) => {
            const columnTasks = visibleTasks.filter((t) => t.status === status);
            return (
              <Droppable droppableId={status} key={status}>
                {(provided) => (
                  <section ref={provided.innerRef} {...provided.droppableProps} className="card kanban__column" aria-label={`${columnTitle} column`}>
                    <div className="row" style={{ "--gap": "8px", marginBottom: "1rem" }}>
                      <span className="kanban__dot" style={{ background: dot }} />
                      <h2 className="small" style={{ margin: 0, fontWeight: 600 }}>{columnTitle}</h2>
                      <span className="muted small">{columnTasks.length}</span>
                    </div>
                    {tasksLoaded && columnTasks.length === 0 && <p className="hint">{canEdit ? "Drop tasks here" : "No tasks"}</p>}
                    {columnTasks.map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id.toString()} index={index} isDragDisabled={!canEdit || filtering}>
                        {(dragProvided) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                            className={`card card--inset ${isOverdue(task) ? "task-card--overdue" : ""}`}
                            style={{ marginBottom: "0.5rem", ...dragProvided.draggableProps.style }}
                          >
                            <div className="row row--between">
                              <button type="button" className="task-title" onClick={() => setEditingTask(task)}>
                                {task.title}
                              </button>
                              {canEdit && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Delete task ${task.title}`}
                                  onClick={() => setToDelete({ kind: "task", id: task.id, name: task.title })}
                                >
                                  ✕
                                </Button>
                              )}
                            </div>
                            <div className="row" style={{ "--gap": "0.25rem", marginTop: "0.5rem" }}>
                              <span className={`badge badge--priority-${task.priority}`}>{task.priority}</span>
                              {task.due_date && (
                                <span className={`badge ${isOverdue(task) ? "badge--overdue" : "badge--muted"}`}>
                                  {isOverdue(task) ? `Overdue: ${task.due_date}` : `Due ${task.due_date}`}
                                </span>
                              )}
                              {task.assignee_username && <span className="badge badge--muted">@{task.assignee_username}</span>}
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </section>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>
      {canEdit && <p className="hint">Tip: tasks can be moved with the keyboard too: focus a task, press Space, use the arrow keys, then Space again.</p>}

      <div style={{ marginTop: "2.5rem" }}>
        <MembersPanel
          projectId={projectId}
          members={members}
          currentUserId={user?.id}
          isOwner={isOwner}
          onChanged={() => Promise.all([fetchMembers(), reloadProject()])}
          onLeft={() => navigate("/projects", { replace: true })}
        />
      </div>

      <div style={{ marginTop: "2.5rem" }}>
        <ActivityPanel projectId={projectId} refreshKey={activityVersion} />
      </div>

      <div className="split" style={{ marginTop: "2.5rem" }}>
        <section className="stack">
          <h2 className="section-title">📁 Files</h2>
          <Card className="grow">
            {canEdit && (
              <>
                <label className="btn btn--primary">
                  {uploading ? "Uploading..." : "+ Upload a file"}
                  <input type="file" accept={UPLOAD_ACCEPT} onChange={uploadFile} disabled={uploading} className="visually-hidden" />
                </label>
                <p className="hint">Images, PDFs, ZIPs and text/code files, up to 10 MB.</p>
              </>
            )}

            {!filesLoaded && <p role="status" className="muted small" style={{ marginTop: "1rem" }}>Loading files...</p>}
            {filesLoaded && files.length === 0 && <p className="muted small" style={{ marginTop: "1rem" }}>No files uploaded yet.</p>}

            <ul className="stack" style={{ marginTop: "1rem", listStyle: "none", padding: 0, "--gap": "0.5rem" }}>
              {files.map((file) => (
                <li key={file.id} className="card card--inset row row--between">
                  <a href={file.url} target="_blank" rel="noreferrer" className="btn btn--link">{file.filename}</a>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete file ${file.filename}`}
                      onClick={() => setToDelete({ kind: "file", id: file.id, name: file.filename })}
                    >
                      ✕
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <ChatPanel projectId={projectId} canPost={canEdit} currentUser={user} members={members} onActivity={handleActivity} />
      </div>

      {suggesting && (
        <TaskSuggestDialog
          projectId={projectId}
          onClose={() => setSuggesting(false)}
          onAdded={(finished) => {
            if (finished) setSuggesting(false);
            fetchTasks();
          }}
        />
      )}

      {editingTask && (
        <TaskModal
          task={editingTask}
          members={members}
          canEdit={canEdit}
          onClose={() => setEditingTask(null)}
          onSaved={() => {
            setEditingTask(null);
            return fetchTasks();
          }}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title={toDelete.kind === "task" ? "Delete this task?" : "Delete this file?"}
          message={`"${toDelete.name}" will be permanently deleted.`}
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </Page>
  );
}

export default Board;
