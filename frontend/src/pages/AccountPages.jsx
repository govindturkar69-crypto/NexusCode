import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { PROVIDERS, completeOAuth, linkWithPassword, peekPendingOAuth, takePendingOAuth } from "../api/oauth";
import { useAuth } from "../auth/useAuth";
import { useFragmentParam } from "../auth/fragment";
import AuthLayout from "../components/auth/AuthLayout";
import PasswordStrength from "../components/auth/PasswordStrength";
import Alert from "../components/ui/Alert";
import { loadLogin, prefetchOn } from "../routes/prefetch";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";

// Signed-out pages reached from the login screen or an email link

function Shell({ title, children }) {
  return (
    <AuthLayout label={title}>
      <div className="auth-card__body motion-stagger">
        <header className="auth-card__header" style={{ "--i": 0 }}>
          <span className="brand__mark auth-card__mark" aria-hidden="true">N</span>
          <h1 className="auth-card__title">{title}</h1>
        </header>
        <div style={{ "--i": 1 }}>{children}</div>
        <p className="muted small auth-card__switch" style={{ "--i": 2 }}>
          <Link to="/login" className="btn btn--link" {...prefetchOn(loadLogin)}>Back to sign in</Link>
        </p>
      </div>
    </AuthLayout>
  );
}

// Same rule as the backend, which still validates
function passwordProblem(password, confirmation) {
  const bytes = new TextEncoder().encode(password).length;
  if (bytes < 8 || bytes > 72) return "Password must be between 8 and 72 bytes long";
  if (password !== confirmation) return "The passwords don't match";
  return "";
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    apiFetch("/auth/password-reset/request", { method: "POST", body: { email }, auth: false })
      .then((data) => setMessage(data.message))
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }

  return (
    <Shell title="Reset your password">
      {message ? (
        <Alert tone="success">{message}</Alert>
      ) : (
        <form onSubmit={submit} className="stack" noValidate>
          <p className="muted small">Enter the verified email address on your account and we'll send you a link.</p>
          <Input label="Email address" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Alert>{error}</Alert>
          <Button type="submit" block size="lg" loading={busy} disabled={!email.trim()}>{busy ? "Sending..." : "Send reset link"}</Button>
        </form>
      )}
    </Shell>
  );
}

export function ResetPassword() {
  const token = useFragmentParam("token");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  function submit(event) {
    event.preventDefault();
    const problem = passwordProblem(password, confirmation);
    setError(problem);
    if (problem) return;
    setBusy(true);
    apiFetch("/auth/password-reset/confirm", { method: "POST", body: { token, new_password: password }, auth: false })
      .then((data) => setDone(data.message))
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }

  if (!token) {
    return (
      <Shell title="Reset your password">
        <Alert>This page needs the link from your email. <Link to="/forgot-password">Ask for a new one.</Link></Alert>
      </Shell>
    );
  }

  return (
    <Shell title="Choose a new password">
      {done ? (
        <Alert tone="success">{done} Other devices have been signed out.</Alert>
      ) : (
        <form onSubmit={submit} className="stack" noValidate>
          <div className="stack" style={{ "--gap": "0.4rem" }}>
            <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <PasswordStrength value={password} />
          </div>
          <Input label="Confirm new password" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          <Alert>{error}</Alert>
          <Button type="submit" block size="lg" loading={busy}>{busy ? "Saving..." : "Set new password"}</Button>
        </form>
      )}
    </Shell>
  );
}

export function VerifyEmail() {
  const token = useFragmentParam("token");
  const [state, setState] = useState(token ? { status: "working" } : { status: "error", text: "This page needs the link from your email." });
  const sent = useRef(false);

  useEffect(() => {
    // Once, even under StrictMode: the token works only once
    if (!token || sent.current) return;
    sent.current = true;
    apiFetch("/auth/verify-email", { method: "POST", body: { token }, auth: false })
      .then((data) => setState({ status: "done", text: data.message }))
      .catch((err) => setState({ status: "error", text: err.message }));
  }, [token]);

  return (
    <Shell title="Email verification">
      {state.status === "working" && <p role="status" className="muted">Checking your link...</p>}
      {state.status === "done" && <Alert tone="success">{state.text}</Alert>}
      {state.status === "error" && <Alert>{state.text} You can send a new link from Settings.</Alert>}
    </Shell>
  );
}

const CALLBACK_ERRORS = {
  cancelled: "The sign-in was cancelled.",
  failed: "That sign-in couldn't be completed. Please start again.",
  missing: "This sign-in was started in another tab or has expired. Please start again.",
};

// Where Google (or another provider) sends the browser back to, by way of the server
export function OAuthCallback() {
  const provider = useFragmentParam("provider");
  const code = useFragmentParam("code");
  const state = useFragmentParam("state");
  const error = useFragmentParam("error");
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState(() => {
    if (error || !provider || !code || !state) return { status: "error", text: CALLBACK_ERRORS[error] ?? CALLBACK_ERRORS.failed };
    if (!peekPendingOAuth(provider)) return { status: "error", text: CALLBACK_ERRORS.missing };
    return { status: "working" };
  });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const started = useRef(false);
  const name = PROVIDERS[provider]?.name ?? "the provider";

  const finish = useCallback((data, returnTo) => {
    if (data.access_token) signIn(data.access_token);
    navigate(returnTo, { replace: true, state: data.status === "linked" ? { notice: `${PROVIDERS[data.provider]?.name ?? "The provider"} is now linked to your account.` } : undefined });
  }, [navigate, signIn]);

  useEffect(() => {
    // Once, even under StrictMode: the code and the stored secrets work only once
    if (started.current || view.status !== "working") return;
    started.current = true;
    const pending = takePendingOAuth(provider);
    completeOAuth(provider, { code, state, nonce: pending.nonce, verifier: pending.verifier, intent: pending.intent })
      .then((data) => {
        if (data.status === "link_required") setView({ status: "link", linkToken: data.link_token, username: data.username, returnTo: pending.returnTo });
        else finish(data, pending.returnTo);
      })
      .catch((err) => setView({ status: "error", text: err.message }));
    // Runs once: view changes only after this starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function link(event) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    linkWithPassword(view.linkToken, password)
      .then((data) => finish(data, view.returnTo))
      .catch((err) => {
        setFormError(err.message);
        setBusy(false);
      });
  }

  return (
    <Shell title={view.status === "link" ? `Link ${name} to your account` : `Signing in with ${name}`}>
      {view.status === "working" && <p role="status" className="muted">Finishing sign-in...</p>}
      {view.status === "error" && <Alert>{view.text}</Alert>}
      {view.status === "link" && (
        <form onSubmit={link} className="stack" noValidate>
          <p className="muted small">
            The NexusCode account <strong>{view.username}</strong> already uses this email address. To sign in
            with {name} from now on, confirm it's yours with its password.
          </p>
          <Input label={`Password for ${view.username}`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Alert>{formError}</Alert>
          <Button type="submit" block size="lg" loading={busy} disabled={!password}>{busy ? "Linking..." : `Link ${name} and sign in`}</Button>
        </form>
      )}
    </Shell>
  );
}
