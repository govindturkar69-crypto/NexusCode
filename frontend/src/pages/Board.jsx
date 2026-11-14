import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Calendar, CodeXml, FileText, Flag, FolderOpen, GripVertical, Plus, Sparkles, Trash2, Upload, Video } from "lucide-react";
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
import Avatar from "../components/ui/Avatar";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Input from "../components/ui/Input";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Skeleton, { LoadingRegion } from "../components/ui/Skeleton";
import { useToast } from "../components/ui/toastContext";
import Tooltip from "../components/ui/Tooltip";

// Mirrors the backend allowlist (app/services/storage.py); the server still validates
const UPLOAD_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.zip,.txt,.md,.csv,.json,.log,.py,.js,.jsx,.ts,.tsx,.java,.c,.cpp,.h,.css,.sql,.yml,.yaml,.toml,.ini";

const COLUMNS = [
  { status: "todo", title: "To Do", tone: "neutral" },
  { status: "in_progress", title: "In Progress", tone: "accent" },
  { status: "done", title: "Done", tone: "success" },
];

const PRIORITY_TONE = { low: "neutral", medium: "accent", high: "danger" };

function TaskCard({ task, index, canDrag, canEdit, fresh, onOpen, onDelete }) {
  const overdue = isOverdue(task);
  return (
    <Draggable draggableId={task.id.toString()} index={index} isDragDisabled={!canDrag}>
      {(dragProvided, snapshot) => (
        <div
          ref={dragProvided.innerRef}
          {...dragProvided.draggableProps}
          className={`task-card ${overdue ? "task-card--overdue" : ""} ${snapshot.isDragging ? "task-card--dragging" : ""} ${snapshot.isDropAnimating ? "task-card--dropping" : ""} ${fresh ? "task-card--fresh" : ""}`}
          style={dragProvided.draggableProps.style}
        >
          {/* The drag handle is its own control, so the title and delete buttons
              aren't nested inside another button (and keyboard drag is on the handle) */}
          {canDrag ? (
            <span {...dragProvided.dragHandleProps} className="task-card__handle" aria-label={`Move "${task.title}"`}>
              <GripVertical size={14} aria-hidden="true" />
            </span>
          ) : (
            <span className="task-card__handle task-card__handle--off" aria-hidden="true" />
          )}
          <div className="task-card__body">
            <div className="task-card__top">
              <button type="button" className="task-title" onClick={() => onOpen(task)}>
                {task.title}
              </button>
              {canEdit && (
                <Button variant="subtle" size="icon" className="task-card__delete" aria-label={`Delete task ${task.title}`} onClick={() => onDelete(task)}>
                  <Trash2 size={13} aria-hidden="true" />
                </Button>
              )}
            </div>
            <div className="task-card__chips">
              <Badge tone={PRIORITY_TONE[task.priority] ?? "neutral"} icon={<Flag size={11} aria-hidden="true" />}>{task.priority}</Badge>
              {task.due_date && (
                <Badge tone={overdue ? "danger" : "neutral"} icon={<Calendar size={11} aria-hidden="true" />}>
                  {overdue ? `Overdue: ${task.due_date}` : `Due ${task.due_date}`}
                </Badge>
              )}
              {task.assignee_username && (
                <span className="task-card__assignee">
                  <Avatar name={task.assignee_username} size="xs" decorative />
                  <span>@{task.assignee_username}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}

function BoardSkeleton() {
  return (
    <LoadingRegion label="Loading tasks…" className="kanban">
      {COLUMNS.map((column) => (
        <div key={column.status} className="kanban__column" aria-hidden="true">
          <Skeleton width="40%" height={12} style={{ marginBottom: "1rem" }} />
          {[0, 1].map((i) => (
            <div key={i} className="task-card task-card--skeleton">
              <Skeleton width="80%" height={12} />
              <Skeleton width="50%" height={10} style={{ marginTop: "0.6rem" }} />
            </div>
          ))}
        </div>
      ))}
    </LoadingRegion>
  );
}

function Board() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { project, role, canEdit, isOwner, error: projectError, reload: reloadProject } = useProject(projectId);
  const [members, setMembers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [freshId, setFreshId] = useState(null);
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
    setAdding(true);
    apiFetch(`/projects/${projectId}/tasks`, { method: "POST", body: { title: title.trim() } })
      .then((data) => {
        setTitle("");
        // The new card slides in (only new cards: moved ones settle with the drag)
        setFreshId(data?.task?.id ?? null);
        return fetchTasks();
      })
      .catch((err) => setError(err.message))
      .finally(() => setAdding(false));
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
      .then(() => {
        toast({ title: "File uploaded", description: selectedFile.name, tone: "success" });
        return fetchFiles();
      })
      .catch((err) => setError(err.message))
      .finally(() => setUploading(false));
  }

  function confirmDelete() {
    const { kind, id, name } = toDelete;
    setDeleting(true);
    setError("");
    apiFetch(kind === "task" ? `/tasks/${id}` : `/files/${id}`, { method: "DELETE" })
      .then(() => {
        toast({ title: kind === "task" ? "Task deleted" : "File deleted", description: name, tone: "info" });
        return kind === "task" ? fetchTasks() : fetchFiles();
      })
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
    setFreshId(null);
    setTasks((prev) => moveTask(prev, taskId, status, destination.index));
    // Always resync afterwards: on failure this undoes the optimistic move
    apiFetch(`/tasks/${taskId}/move`, { method: "PATCH", body: { status, index: destination.index } })
      .catch((err) => setError(err.message))
      .finally(() => fetchTasks());
  }

  const filtering = assigneeFilter !== "";
  const visibleTasks = filterByAssignee(tasks, assigneeFilter);

  return (
    <Page width={1240}>
      <PageHeader
        title={project?.name ?? "Project Board"}
        description={project?.description || undefined}
        actions={
          <>
            {role && <RoleBadge role={role} />}
            <Link className="btn btn--secondary" to={`/projects/${projectId}/editor`}>
              <CodeXml size={16} aria-hidden="true" /> Open editor
            </Link>
            <Link className="btn btn--secondary" to={`/projects/${projectId}/meeting`}>
              <Video size={16} aria-hidden="true" /> Meeting
            </Link>
          </>
        }
      />

      <Alert onDismiss={() => setError("")}>{error}</Alert>
      {projectError && <Alert>{projectError}</Alert>}

      {role === "viewer" && (
        <Alert tone="info">You have view-only access to this project. Ask an owner if you need to make changes.</Alert>
      )}

      <div className="board-toolbar">
        {canEdit && (
          <form onSubmit={createTask} className="board-toolbar__add">
            <Input label="New task title" hideLabel placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} className="grow" />
            <Button type="submit" disabled={!title.trim()} loading={adding} icon={<Plus size={16} aria-hidden="true" />}>Add task</Button>
            <Button variant="secondary" icon={<Sparkles size={15} aria-hidden="true" />} onClick={() => setSuggesting(true)}>Generate tasks</Button>
          </form>
        )}
        <div className="board-toolbar__filter">
          <label htmlFor="assignee-filter" className="small muted">Assignee</label>
          <select id="assignee-filter" className="input input--sm" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
            <option value="">Everyone</option>
            <option value="unassigned">Unassigned</option>
            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>{member.username}</option>
            ))}
          </select>
          {filtering && canEdit && <span className="hint" style={{ margin: 0 }}>Clear the filter to drag tasks.</span>}
        </div>
      </div>

      {!tasksLoaded ? (
        <BoardSkeleton />
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="kanban">
            {COLUMNS.map(({ status, title: columnTitle, tone }) => {
              const columnTasks = visibleTasks.filter((t) => t.status === status);
              return (
                <Droppable droppableId={status} key={status}>
                  {(provided, snapshot) => (
                    <section
                      className={`kanban__column ${snapshot.isDraggingOver ? "kanban__column--over" : ""}`}
                      aria-label={`${columnTitle} column`}
                    >
                      <header className="kanban__head">
                        <span className={`kanban__dot kanban__dot--${tone}`} aria-hidden="true" />
                        <h2 className="kanban__title">{columnTitle}</h2>
                        <span key={columnTasks.length} className="kanban__count motion-pop" aria-label={`${columnTasks.length} tasks`}>{columnTasks.length}</span>
                      </header>
                      <div ref={provided.innerRef} {...provided.droppableProps} className="kanban__list">
                        {columnTasks.length === 0 && !snapshot.isDraggingOver && (
                          <p className="kanban__empty">{canEdit ? "Drop tasks here" : "No tasks"}</p>
                        )}
                        {columnTasks.map((task, index) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            index={index}
                            canDrag={canEdit && !filtering}
                            canEdit={canEdit}
                            fresh={task.id === freshId}
                            onOpen={setEditingTask}
                            onDelete={(t) => setToDelete({ kind: "task", id: t.id, name: t.title })}
                          />
                        ))}
                        {provided.placeholder}
                      </div>
                    </section>
                  )}
                </Droppable>
              );
            })}
          </div>
        </DragDropContext>
      )}
      {canEdit && <p className="hint">Tip: tasks can be moved with the keyboard too: focus a task's handle, press Space, use the arrow keys, then Space again.</p>}

      <div className="board-sections">
        <div className="board-sections__main">
          <ChatPanel projectId={projectId} canPost={canEdit} currentUser={user} members={members} onActivity={handleActivity} />
          <ActivityPanel projectId={projectId} refreshKey={activityVersion} />
        </div>
        <div className="board-sections__side">
          <MembersPanel
            projectId={projectId}
            members={members}
            currentUserId={user?.id}
            isOwner={isOwner}
            onChanged={() => Promise.all([fetchMembers(), reloadProject()])}
            onLeft={() => navigate("/projects", { replace: true })}
          />

          <section className="stack">
            <h2 className="section-title"><FolderOpen size={17} aria-hidden="true" /> Files</h2>
            <Card className="grow">
              {canEdit && (
                <>
                  <label className={`btn btn--secondary file-upload ${uploading ? "btn--loading" : ""}`}>
                    <Upload size={15} aria-hidden="true" />
                    {uploading ? "Uploading…" : "Upload a file"}
                    <input type="file" accept={UPLOAD_ACCEPT} onChange={uploadFile} disabled={uploading} className="visually-hidden" />
                  </label>
                  <p className="hint">Images, PDFs, ZIPs and text/code files, up to 10 MB.</p>
                </>
              )}

              {!filesLoaded && (
                <LoadingRegion label="Loading files…" className="stack" >
                  <Skeleton height={32} style={{ marginTop: "1rem" }} />
                </LoadingRegion>
              )}
              {filesLoaded && files.length === 0 && <p className="muted small" style={{ marginTop: "1rem" }}>No files uploaded yet.</p>}

              <ul className="file-list motion-stagger">
                {files.map((file, i) => (
                  <li key={file.id} className="file-list__item" style={{ "--i": i }}>
                    <FileText size={15} aria-hidden="true" />
                    <a href={file.url} target="_blank" rel="noreferrer" className="file-list__name">{file.filename}</a>
                    {canEdit && (
                      <Tooltip label="Delete file">
                        <Button
                          variant="subtle"
                          size="icon"
                          aria-label={`Delete file ${file.filename}`}
                          onClick={() => setToDelete({ kind: "file", id: file.id, name: file.filename })}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </Button>
                      </Tooltip>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        </div>
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
            toast({ title: "Task saved", tone: "success" });
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
