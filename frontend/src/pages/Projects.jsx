import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FolderPlus, Plus, Trash2 } from "lucide-react";
import { apiFetch, apiFetchAll } from "../api/client";
import { completeGithubLink, takePendingLink } from "../api/github";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Input from "../components/ui/Input";
import Modal from "../components/ui/Modal";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Skeleton, { LoadingRegion } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { useToast } from "../components/ui/toastContext";
import Tooltip from "../components/ui/Tooltip";
import RoleBadge from "../components/RoleBadge";
import { relativeTime } from "../utils/time";

const GITHUB_MESSAGES = {
  connected: { text: "GitHub account connected.", tone: "success" },
  error: { text: "Couldn't connect your GitHub account. Please try again.", tone: "error" },
};

function NewProjectDialog({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const nameError = touched && !name.trim() ? "Give the project a name." : "";

  function submit(event) {
    event.preventDefault();
    setTouched(true);
    if (!name.trim()) return;
    setError("");
    setCreating(true);
    apiFetch("/projects", { method: "POST", body: { name: name.trim(), description: description.trim() || null } })
      .then((data) => onCreated(data.project))
      .catch((err) => {
        setError(err.message);
        setCreating(false);
      });
  }

  return (
    <Modal title="New project" description="A board, chat, files and a shared code editor for your team." onClose={creating ? () => {} : onClose}>
      <form onSubmit={submit} className="stack" style={{ "--gap": "1rem" }} noValidate>
        <Input
          label="Name"
          placeholder="e.g. Weather CLI"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          error={nameError}
          maxLength={200}
          autoComplete="off"
          required
        />
        <Input
          label="Description (optional)"
          placeholder="What is it for?"
          multiline
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Alert>{error}</Alert>
        <div className="modal__actions" style={{ marginTop: 0 }}>
          <Button variant="secondary" onClick={onClose} disabled={creating}>Cancel</Button>
          <Button type="submit" loading={creating}>Create project</Button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectsSkeleton() {
  return (
    <LoadingRegion label="Loading projects…" className="project-grid">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card project-card" aria-hidden="true">
          <div className="row" style={{ "--gap": "0.75rem" }}>
            <Skeleton width={36} height={36} radius={10} />
            <div className="grow stack" style={{ "--gap": "0.5rem" }}>
              <Skeleton width="60%" height={14} />
              <Skeleton width="30%" height={10} />
            </div>
          </div>
          <Skeleton width="90%" height={10} style={{ marginTop: "1rem" }} />
        </div>
      ))}
    </LoadingRegion>
  );
}

function Projects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  // Set after GitHub linking finishes (see the effect below)
  const githubMessage = GITHUB_MESSAGES[searchParams.get("github")];

  const fetchProjects = useCallback(() => {
    return apiFetchAll("/projects", "projects")
      .then((list) => {
        setProjects(list);
        setLoadError("");
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Coming back from GitHub: finish linking (takePendingLink clears the URL
  // fragment synchronously, so React StrictMode's second run finds nothing).
  useEffect(() => {
    const pending = takePendingLink();
    if (!pending) return;
    completeGithubLink(pending)
      .then(() => navigate("/projects?github=connected", { replace: true }))
      .catch(() => navigate("/projects?github=error", { replace: true }));
  }, [navigate]);

  function retry() {
    setLoading(true);
    fetchProjects();
  }

  function created(project) {
    setCreating(false);
    toast({ title: "Project created", description: project?.name, tone: "success" });
    fetchProjects();
  }

  function confirmDelete() {
    setDeleting(true);
    const name = toDelete.name;
    apiFetch(`/projects/${toDelete.id}`, { method: "DELETE" })
      .then(() => {
        setToDelete(null);
        toast({ title: "Project deleted", description: name, tone: "info" });
        return fetchProjects();
      })
      .catch((err) => {
        setToDelete(null);
        setError(err.message);
      })
      .finally(() => setDeleting(false));
  }

  const newButton = (
    <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreating(true)}>New project</Button>
  );

  return (
    <Page width={1040}>
      <PageHeader title="Projects" description="Everything you're a member of." actions={!loading && !loadError && projects.length > 0 ? newButton : null} />

      {githubMessage && (
        <Alert tone={githubMessage.tone} onDismiss={() => navigate("/projects", { replace: true })}>
          {githubMessage.text}
        </Alert>
      )}
      <Alert>{error}</Alert>

      {loading && <ProjectsSkeleton />}

      {!loading && loadError && (
        <ErrorState title="Couldn't load your projects" message={loadError} onRetry={retry} />
      )}

      {!loading && !loadError && projects.length === 0 && (
        <EmptyState icon={<FolderPlus size={26} />} title="No projects yet" action={newButton}>
          Create your first one to get a Kanban board, chat, file storage and a shared code editor.
        </EmptyState>
      )}

      {!loading && !loadError && projects.length > 0 && (
        <ul className="project-grid motion-stagger" aria-label="Your projects">
          {projects.map((project, i) => (
            <li key={project.id} style={{ "--i": i }}>
              {/* The name is a real link for keyboard and screen readers; clicking
                  anywhere else on the card is a mouse shortcut to the same place. */}
              <div className="card card--interactive project-card" onClick={() => navigate(`/projects/${project.id}`)}>
                <div className="project-card__top">
                  <span className="project-card__icon" aria-hidden="true">{project.name.slice(0, 1).toUpperCase()}</span>
                  <div className="project-card__title">
                    <Link to={`/projects/${project.id}`} className="project-link" onClick={(e) => e.stopPropagation()}>
                      {project.name}
                    </Link>
                    <RoleBadge role={project.role} />
                  </div>
                  {project.role === "owner" && (
                    <Tooltip label="Delete project">
                      <Button
                        variant="subtle"
                        size="icon"
                        className="project-card__delete"
                        aria-label={`Delete project ${project.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setToDelete(project);
                        }}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </Button>
                    </Tooltip>
                  )}
                </div>
                <p className="project-card__description">{project.description || "No description."}</p>
                {project.updated_at && (
                  <p className="project-card__meta">Updated <time dateTime={project.updated_at}>{relativeTime(project.updated_at)}</time></p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating && <NewProjectDialog onClose={() => setCreating(false)} onCreated={created} />}

      {toDelete && (
        <ConfirmDialog
          title={`Delete "${toDelete.name}"?`}
          message="This permanently deletes the project with its tasks, files, chat history and code, for every member."
          confirmLabel="Delete project"
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </Page>
  );
}

export default Projects;
