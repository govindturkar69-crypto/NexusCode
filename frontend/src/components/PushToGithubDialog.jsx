import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import Button from "./ui/Button";
import Input from "./ui/Input";
import Modal from "./ui/Modal";

// Same rule the backend enforces
const REPO_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

// beforePush saves unsaved changes first, so the commit has what's on screen
function PushToGithubDialog({ projectId, fileCount, beforePush, onClose, onPushed }) {
  const [target, setTarget] = useState("new"); // new | existing
  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [branch, setBranch] = useState("");
  const [repos, setRepos] = useState(null);
  const [branches, setBranches] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const existing = target === "existing";
  const notConnected = error === "GitHub account not connected";

  useEffect(() => {
    if (!existing || repos !== null) return;
    apiFetch("/me/github/repos")
      .then((data) => setRepos(data.repos ?? []))
      .catch((err) => {
        setRepos([]);
        setError(err.message);
      });
  }, [existing, repos]);

  function chooseTarget(next) {
    setTarget(next);
    setRepoName("");
    setBranch("");
    setBranches([]);
    setError("");
  }

  function chooseRepo(name) {
    setRepoName(name);
    setBranches([]);
    const repo = repos?.find((r) => r.name === name);
    setBranch(repo?.default_branch ?? "");
    if (!name) return;
    apiFetch(`/me/github/repos/${encodeURIComponent(name)}/branches`)
      .then((data) => setBranches(data.branches ?? []))
      .catch((err) => setError(err.message));
  }

  function submit(event) {
    event.preventDefault();
    if (!REPO_NAME_PATTERN.test(repoName)) {
      setError("Use letters, numbers, '.', '-' and '_' only (max 100).");
      return;
    }
    setError("");
    setBusy(true);
    const body = { repo_name: repoName, existing };
    if (!existing) body.private = isPrivate;
    if (branch.trim()) body.branch = branch.trim();
    beforePush()
      .then(() => apiFetch(`/projects/${projectId}/push-to-github`, { method: "POST", body }))
      .then(onPushed)
      .catch((err) => {
        setError(err.message);
        setBusy(false);
      });
  }

  return (
    <Modal title="Push to GitHub" onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="stack" noValidate>
        <p className="muted small">
          All {fileCount} file{fileCount === 1 ? "" : "s"} go in one commit.
        </p>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, "--gap": "0.25rem" }}>
          <legend className="visually-hidden">Where to push</legend>
          <label className="checkbox">
            <input type="radio" name="push-target" checked={!existing} onChange={() => chooseTarget("new")} />
            New repository
          </label>
          <label className="checkbox">
            <input type="radio" name="push-target" checked={existing} onChange={() => chooseTarget("existing")} />
            One of my repositories
          </label>
        </fieldset>

        {existing ? (
          <div className="field">
            <label htmlFor="push-repo" className="field__label">Repository</label>
            <select id="push-repo" className="input" value={repoName} onChange={(e) => chooseRepo(e.target.value)} disabled={repos === null}>
              <option value="">{repos === null ? "Loading..." : "Choose a repository"}</option>
              {(repos ?? []).map((repo) => (
                <option key={repo.full_name} value={repo.name}>
                  {repo.full_name}{repo.private ? " (private)" : ""}
                </option>
              ))}
            </select>
            {repos !== null && repos.length === 0 && !error && <p className="hint">You have no repositories yet.</p>}
          </div>
        ) : (
          <>
            <Input
              label="Repository name"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="my-project"
              hint="Letters, numbers, '.', '-' and '_'"
              autoComplete="off"
            />
            <label className="checkbox">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
              Private repository
            </label>
          </>
        )}

        <Input
          label="Branch"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
          list="push-branches"
          autoComplete="off"
          hint={existing ? "A name that doesn't exist yet creates that branch. Files only on GitHub are kept." : "Leave empty for the default branch."}
        />
        <datalist id="push-branches">
          {branches.map((name) => <option key={name} value={name} />)}
        </datalist>

        {error && (
          <p role="alert" className="small text-danger">
            {error}
            {notConnected && <> <Link to="/settings">Connect it in Settings.</Link></>}
          </p>
        )}
        <div className="modal__actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !repoName}>{busy ? "Pushing..." : "Push"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default PushToGithubDialog;
