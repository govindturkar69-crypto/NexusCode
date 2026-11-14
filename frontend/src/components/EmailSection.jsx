import { Mail } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import Alert from "./ui/Alert";
import Button from "./ui/Button";
import Card from "./ui/Card";
import Input from "./ui/Input";

// The account's email address, and whether this server can send email at all.
// Children get the loaded state, so later sections (verification) can build on it.
function EmailSection({ children }) {
  const [info, setInfo] = useState(null);
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(
    () =>
      apiFetch("/me/email")
        .then((data) => {
          setInfo(data);
          return data;
        })
        .catch((err) => setError(err.message)),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  function startEditing() {
    setEmail(info?.email ?? "");
    setPassword("");
    setError("");
    setNotice("");
    setEditing(true);
  }

  function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const body = { email };
    if (info.has_password) body.current_password = password;
    apiFetch("/me/email", { method: "PUT", body })
      .then((data) => {
        setInfo(data);
        setEditing(false);
        setNotice(data.email ? `Saved ${data.email}.` : "");
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }

  function sendTest() {
    setBusy(true);
    setError("");
    setNotice("");
    apiFetch("/me/email/test", { method: "POST" })
      .then((data) => setNotice(data.message))
      .catch((err) => setError(err.message))
      // Sending can reveal a restriction, which the status line then shows
      .finally(() => {
        setBusy(false);
        load();
      });
  }

  const sending = info?.sending;

  return (
    <section className="stack">
      <h2 className="section-title section-title--icon"><Mail size={18} aria-hidden="true" /> Email</h2>
      <Card className="stack">
        {info === null && !error && <p role="status" className="muted small">Loading...</p>}
        {sending && !sending.enabled && <p className="small muted">{sending.message}</p>}
        {sending?.enabled && sending.restricted && (
          <p className="small text-danger" role="note">Sending is restricted: {sending.message}</p>
        )}

        {info && !editing && (
          <>
            <p className="small">
              {info.email ? (
                <>
                  <strong>{info.email}</strong>{" "}
                  <span className={`badge ${info.email_verified ? "badge--editor" : "badge--muted"}`}>
                    {info.email_verified ? "verified" : "not verified"}
                  </span>
                </>
              ) : (
                <span className="muted">No email address yet. Add one to be able to reset your password.</span>
              )}
            </p>
            {typeof children === "function" ? children({ info, reload: load }) : null}
            <div className="row">
              <Button variant="ghost" onClick={startEditing} disabled={busy}>{info.email ? "Change email" : "Add email"}</Button>
              {info.email && sending?.enabled && (
                <Button variant="ghost" onClick={sendTest} disabled={busy}>{busy ? "Sending..." : "Send a test email"}</Button>
              )}
            </div>
          </>
        )}

        {info && editing && (
          <form onSubmit={save} className="stack" noValidate>
            <Input label="Email address" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {info.has_password && (
              <Input
                label="Your password"
                type="password"
                autoComplete="current-password"
                hint="Needed because password reset emails go to this address."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            <div className="row">
              <Button type="submit" disabled={busy || !email.trim() || (info.has_password && !password)}>
                {busy ? "Saving..." : "Save email"}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
            </div>
          </form>
        )}

        {notice && <Alert tone="success" onDismiss={() => setNotice("")}>{notice}</Alert>}
        <Alert>{error}</Alert>
      </Card>
    </section>
  );
}

export default EmailSection;
