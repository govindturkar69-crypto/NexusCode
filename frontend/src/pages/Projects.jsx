import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch, apiFetchAll } from "../api/client";
import { completeGithubLink, startGithubLink, takePendingLink } from "../api/github";
import { useAuth } from "../auth/useAuth";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Input from "../components/ui/Input";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";

const GITHUB_MESSAGES = {
  connected: { text: "GitHub account connected.", tone: "success" },
  error: { text: "Couldn't connect your GitHub account. Please try again.", tone: "error" },
};

function Projects() {
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const isAdmin = Boolean(user?.is_admin);
  const [searchParams] = useSearchParams();
  // Set after GitHub linking finishes (see the effect below)
  const githubMessage = GITHUB_MESSAGES[searchParams.get("github")];

  const fetchProjects = useCallback(() => {
    return apiFetchAll("/projects", "projects")
      .then(setProjects)
      .catch((err) => setError(err.message))
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

  function createProject(event) {
    event.preventDefault();
    if (!name.trim()) return;
    setError("");
    setCreating(true);
    apiFetch("/projects", { method: "POST", body: { name: name.trim(), description: description.trim() || null } })
      .then(() => {
        setName("");
        setDescription("");
        return fetchProjects();
      })
      .catch((err) => setError(err.message))
      .finally(() => setCreating(false));
  }

  function confirmDelete() {
    setDeleting(true);
    apiFetch(`/projects/${toDelete.id}`, { method: "DELETE" })
      .then(() => {
        setToDelete(null);
        return fetchProjects();
      })
      .catch((err) => {
        setToDelete(null);
        setError(err.message);
      })
      .finally(() => setDeleting(false));
  }

  function logout() {
    signOut();
    navigate("/login");
  }

  function connectGithub() {
    setError("");
    startGithubLink().catch((err) => setError(err.message));
  }

  return (
    <Page width={760}>
      <PageHeader
        eyebrow={user ? `${user.username}-workspace` : "your-workspace"}
        title="My Projects"
        actions={
          <>
            {isAdmin && <Button variant="danger" onClick={() => navigate("/admin")}>🛠️ Admin</Button>}
            <Button variant="ghost" onClick={() => navigate("/dashboard")}>📊 Dashboard</Button>
            <Button onClick={() => navigate("/ai")}>✨ AI Assistant</Button>
            <Button variant="ghost" onClick={connectGithub}>🐙 Connect GitHub</Button>
            <Button variant="ghost" onClick={logout}>Log out</Button>
          </>
        }
      />

      {githubMessage && (
        <Alert tone={githubMessage.tone} onDismiss={() => navigate("/projects", { replace: true })}>
          {githubMessage.text}
        </Alert>
      )}

      <Card as="form" onSubmit={createProject} className="row" style={{ marginBottom: "2rem", alignItems: "flex-end" }}>
        <Input label="Project name" hideLabel placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} className="grow" />
        <Input label="Description (optional)" hideLabel placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} className="grow" />
        <Button type="submit" disabled={creating || !name.trim()}>{creating ? "Creating..." : "+ New Project"}</Button>
      </Card>

      <Alert>{error}</Alert>

      {loading && <p role="status" className="muted">Loading projects...</p>}

      {!loading && !error && projects.length === 0 && (
        <Card>
          <p className="muted">No projects yet. Create your first one above to get a Kanban board, chat, file storage and a code editor.</p>
        </Card>
      )}

      <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {projects.map((project) => (
          <li key={project.id}>
            {/* The name is a real link for keyboard/screen readers; clicking
                anywhere else on the card is a mouse shortcut to the same place. */}
            <div className="card card--interactive" onClick={() => navigate(`/projects/${project.id}`)}>
              <div className="row row--between" style={{ alignItems: "flex-start" }}>
                <div className="grow">
                  <Link to={`/projects/${project.id}`} className="project-link" onClick={(e) => e.stopPropagation()}>
                    {project.name}
                  </Link>
                  {project.description && <p className="muted small" style={{ marginTop: "4px" }}>{project.description}</p>}
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  aria-label={`Delete project ${project.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setToDelete(project);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {toDelete && (
        <ConfirmDialog
          title={`Delete "${toDelete.name}"?`}
          message="This permanently deletes the project with its tasks, files, chat history and code."
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
