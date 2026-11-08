import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useFragmentParam } from "../auth/fragment";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";

// Signed-out pages reached from the login screen or an email link

function Shell({ prompt, title, children }) {
  return (
    <main className="page page--centered">
      <div className="card" style={{ width: "100%", maxWidth: "400px", padding: "2.5rem", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          <div className="eyebrow">{prompt}</div>
          <h1 className="page-title" style={{ fontSize: "24px" }}>{title}</h1>
        </div>
        {children}
        <p className="muted small" style={{ textAlign: "center", marginTop: "1.5rem" }}>
          <Link to="/login" className="btn btn--link">Back to sign in</Link>
        </p>
      </div>
    </main>
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
    <Shell prompt="$ forgot-password" title="Reset your password">
      {message ? (
        <Alert tone="success">{message}</Alert>
      ) : (
        <form onSubmit={submit} className="stack" noValidate>
          <p className="muted small">Enter the verified email address on your account and we'll send you a link.</p>
          <Input label="Email address" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Alert>{error}</Alert>
          <Button type="submit" block disabled={busy || !email.trim()}>{busy ? "Sending..." : "Send reset link"}</Button>
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
      <Shell prompt="$ reset-password" title="Reset your password">
        <Alert>This page needs the link from your email. <Link to="/forgot-password">Ask for a new one.</Link></Alert>
      </Shell>
    );
  }

  return (
    <Shell prompt="$ reset-password" title="Choose a new password">
      {done ? (
        <Alert tone="success">{done} Other devices have been signed out.</Alert>
      ) : (
        <form onSubmit={submit} className="stack" noValidate>
          <Input label="New password" type="password" autoComplete="new-password" hint="8 to 72 bytes." value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input label="Confirm new password" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          <Alert>{error}</Alert>
          <Button type="submit" block disabled={busy}>{busy ? "Saving..." : "Set new password"}</Button>
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
    <Shell prompt="$ verify-email" title="Email verification">
      {state.status === "working" && <p role="status" className="muted">Checking your link...</p>}
      {state.status === "done" && <Alert tone="success">{state.text}</Alert>}
      {state.status === "error" && <Alert>{state.text} You can send a new link from Settings.</Alert>}
    </Shell>
  );
}
