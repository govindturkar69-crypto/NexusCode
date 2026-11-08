import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { startGithubLink } from "../api/github";
import { useAuth } from "../auth/useAuth";
import Alert from "../components/ui/Alert";
import BackLink from "../components/ui/BackLink";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import EmailSection from "../components/EmailSection";
import SignInMethodsSection from "../components/SignInMethodsSection";
import { useSignInMethods } from "../auth/useSignInMethods";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Input from "../components/ui/Input";
import Modal from "../components/ui/Modal";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";

// Same rule as the backend (app/schemas/auth.py), which still validates
function newPasswordProblem(password, confirmation) {
  const bytes = new TextEncoder().encode(password).length;
  if (bytes < 8 || bytes > 72) return "Password must be between 8 and 72 bytes long";
  if (password !== confirmation) return "The new passwords don't match";
  return "";
}

function PasswordSection() {
  const { signIn } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function submit(event) {
    event.preventDefault();
    setSaved(false);
    const problem = newPasswordProblem(next, confirmation);
    setError(problem);
    if (problem) return;
    setBusy(true);
    apiFetch("/me/password", { method: "POST", body: { current_password: current, new_password: next } })
      .then((data) => {
        // Changing the password ended every session, this one included; carry on with the new token
        signIn(data.access_token);
        setSaved(true);
        setCurrent("");
        setNext("");
        setConfirmation("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }

  return (
    <section className="stack">
      <h2 className="section-title">🔑 Change password</h2>
      <Card as="form" onSubmit={submit} className="stack">
        {saved && <Alert tone="success" onDismiss={() => setSaved(false)}>Password changed. Other devices have been signed out.</Alert>}
        <Alert>{error}</Alert>
        <Input label="Current password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Input label="New password" type="password" autoComplete="new-password" required hint="8 to 72 bytes." value={next} onChange={(e) => setNext(e.target.value)} />
        <Input label="Confirm new password" type="password" autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        <div>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Change password"}</Button>
        </div>
      </Card>
    </section>
  );
}

// For accounts made with Google or GitHub, which start without a password
function SetPasswordSection({ onSet }) {
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function submit(event) {
    event.preventDefault();
    const problem = newPasswordProblem(next, confirmation);
    setError(problem);
    if (problem) return;
    setBusy(true);
    apiFetch("/me/password/set", { method: "POST", body: { new_password: next } })
      .then((data) => onSet(data.message))
      .catch((err) => {
        setError(err.message);
        setBusy(false);
      });
  }

  return (
    <section className="stack">
      <h2 className="section-title">🔑 Set a password</h2>
      <Card as="form" onSubmit={submit} className="stack">
        <p className="small muted">You sign in with Google or GitHub. Add a password to also sign in with your username, and to delete your account.</p>
        <Alert>{error}</Alert>
        <Input label="New password" type="password" autoComplete="new-password" required hint="8 to 72 bytes." value={next} onChange={(e) => setNext(e.target.value)} />
        <Input label="Confirm new password" type="password" autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        <div>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Set password"}</Button>
        </div>
      </Card>
    </section>
  );
}

function GitHubSection() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchStatus = useCallback(() => {
    return apiFetch("/me/github")
      .then(setStatus)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  function connect() {
    setError("");
    startGithubLink().catch((err) => setError(err.message));
  }

  function disconnect() {
    setBusy(true);
    setError("");
    apiFetch("/me/github", { method: "DELETE" })
      .then(fetchStatus)
      .catch((err) => setError(err.message))
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  }

  return (
    <section className="stack">
      <h2 className="section-title">🐙 GitHub repositories</h2>
      <Card className="stack">
        <Alert>{error}</Alert>
        {status === null && !error && <p role="status" className="muted small">Checking your connection...</p>}
        {status && !status.connected && (
          <>
            <p className="muted small">Not connected. Connect GitHub to push project code to a repository.</p>
            <div><Button onClick={connect}>Connect GitHub</Button></div>
          </>
        )}
        {status?.connected && (
          <>
            {status.username && <p className="small">Connected as <strong>@{status.username}</strong></p>}
            {!status.username && !status.expired && <p className="small">Connected. GitHub didn't tell us the username just now.</p>}
            {status.expired && <p className="small text-danger">GitHub no longer accepts this connection. Reconnect to push code again.</p>}
            <div className="row">
              {status.expired && <Button onClick={connect}>Reconnect</Button>}
              <Button variant="danger" onClick={() => setConfirming(true)}>Disconnect</Button>
            </div>
          </>
        )}
      </Card>
      {confirming && (
        <ConfirmDialog
          title="Disconnect GitHub?"
          message="NexusCode will delete its stored GitHub token, and you won't be able to push until you reconnect. To revoke access on GitHub's side too, use Settings > Applications on GitHub."
          confirmLabel="Disconnect"
          busy={busy}
          onConfirm={disconnect}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}

function DeletionPlanList({ plan }) {
  const nothing = plan.deleted.length + plan.transferred.length + plan.left.length === 0;
  if (nothing) return <p className="muted small">You aren't in any projects.</p>;
  return (
    <div className="stack small">
      {plan.deleted.length > 0 && (
        <div>
          <strong className="text-danger">Permanently deleted, with their files (nobody else is in them):</strong>
          <ul>{plan.deleted.map((p) => <li key={p.project_id}>{p.name}</li>)}</ul>
        </div>
      )}
      {plan.transferred.length > 0 && (
        <div>
          <strong>Passed to a new owner:</strong>
          <ul>{plan.transferred.map((p) => <li key={p.project_id}>{p.name} → @{p.new_owner}</li>)}</ul>
        </div>
      )}
      {plan.left.length > 0 && (
        <div>
          <strong>You leave, and they carry on:</strong>
          <ul>{plan.left.map((p) => <li key={p.project_id}>{p.name}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function DeleteAccountSection({ hasPassword }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Fetched on opening, so it describes the projects as they are right now
  function start() {
    setError("");
    setPassword("");
    setPlan(null);
    setOpen(true);
    apiFetch("/me/deletion-plan")
      .then(setPlan)
      .catch((err) => setError(err.message));
  }

  function confirm(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    apiFetch("/me/delete", { method: "POST", body: { password } })
      .then(() => {
        signOut();
        navigate("/login", { replace: true });
      })
      .catch((err) => {
        setError(err.message);
        setBusy(false);
      });
  }

  return (
    <section className="stack">
      <h2 className="section-title">⚠️ Delete account</h2>
      <Card className="stack">
        <p className="muted small">
          This can't be undone. Your chat messages stay in shared projects under your old name, marked as removed.
        </p>
        {hasPassword === false ? (
          <p className="small muted">Set a password first. Deleting your account asks for it.</p>
        ) : (
          <div><Button variant="danger" onClick={start}>Delete my account...</Button></div>
        )}
      </Card>
      {open && (
        <Modal
          title="Delete your account?"
          onClose={busy ? () => {} : () => setOpen(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy} autoFocus>Cancel</Button>
              <Button type="submit" form="delete-account" variant="danger-solid" disabled={busy || !plan || !password}>
                {busy ? "Deleting..." : "Delete my account"}
              </Button>
            </>
          }
        >
          <form id="delete-account" onSubmit={confirm} className="stack">
            <Alert>{error}</Alert>
            {!plan && !error && <p role="status" className="muted small">Checking your projects...</p>}
            {plan && <DeletionPlanList plan={plan} />}
            <Input label="Confirm with your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </form>
        </Modal>
      )}
    </section>
  );
}

function VerifyEmailButton({ info }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (!info.email || info.email_verified || !info.sending.enabled) return null;

  function send() {
    setBusy(true);
    setError("");
    apiFetch("/me/email/verification", { method: "POST" })
      .then((data) => setMessage(data.message))
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }

  return (
    <div className="stack" style={{ "--gap": "0.5rem" }}>
      <p className="small muted">Verify this address so you can use it to reset your password.</p>
      <div><Button onClick={send} disabled={busy}>{busy ? "Sending..." : "Send verification email"}</Button></div>
      {message && <Alert tone="success" onDismiss={() => setMessage("")}>{message}</Alert>}
      <Alert>{error}</Alert>
    </div>
  );
}

function SessionsSection() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function signOutOthers() {
    setBusy(true);
    setError("");
    apiFetch("/me/sessions/revoke", { method: "POST" })
      .then((data) => {
        signIn(data.access_token);
        setMessage(data.message);
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }

  return (
    <section className="stack">
      <h2 className="section-title">💻 Sessions</h2>
      <Card className="stack">
        <p className="small muted">Signed in somewhere you've lost track of? This signs out every other browser and device. You stay signed in here.</p>
        <div><Button variant="ghost" onClick={signOutOthers} disabled={busy}>{busy ? "Signing out..." : "Sign out of other devices"}</Button></div>
        {message && <Alert tone="success" onDismiss={() => setMessage("")}>{message}</Alert>}
        <Alert>{error}</Alert>
      </Card>
    </section>
  );
}

function Settings() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { methods, error: methodsError, reload } = useSignInMethods();
  // A message handed over by the page that sent us here (after linking an account)
  const [notice, setNotice] = useState(() => location.state?.notice ?? "");
  const [passwordSet, setPasswordSet] = useState("");

  useEffect(() => {
    // Clear it from history, so a reload doesn't show it again
    if (location.state?.notice) navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate]);

  function onPasswordSet(message) {
    setPasswordSet(message);
    reload();
  }

  return (
    <Page width={640}>
      <BackLink to="/projects">All projects</BackLink>
      <PageHeader eyebrow="settings" title="Profile and settings">
        {user && <p className="muted small">Signed in as <strong>{user.username}</strong></p>}
      </PageHeader>
      <div className="stack" style={{ gap: "2rem" }}>
        <EmailSection>{({ info }) => <VerifyEmailButton info={info} />}</EmailSection>
        <SignInMethodsSection methods={methods} error={methodsError} reload={reload} notice={notice} onDismissNotice={() => setNotice("")} />
        {passwordSet && <Alert tone="success" onDismiss={() => setPasswordSet("")}>{passwordSet}</Alert>}
        {methods?.has_password === false ? <SetPasswordSection onSet={onPasswordSet} /> : <PasswordSection />}
        <GitHubSection />
        <SessionsSection />
        <DeleteAccountSection hasPassword={methods?.has_password} />
      </div>
    </Page>
  );
}

export default Settings;
