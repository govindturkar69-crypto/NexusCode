import { useState } from "react";
import { apiFetch } from "../api/client";
import { PROVIDERS, startOAuth } from "../api/oauth";
import Alert from "./ui/Alert";
import Button from "./ui/Button";
import Card from "./ui/Card";
import ConfirmDialog from "./ui/ConfirmDialog";

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function SignInMethodsSection({ methods, error: loadError, reload, notice, onDismissNotice }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const [unlinking, setUnlinking] = useState(null);

  if (!methods) {
    return (
      <section className="stack">
        <h2 className="section-title">🔐 Sign-in methods</h2>
        <Card className="stack">
          {loadError ? <Alert>{loadError}</Alert> : <p role="status" className="muted small">Loading...</p>}
        </Card>
      </section>
    );
  }

  const linked = Object.fromEntries(methods.identities.map((i) => [i.provider, i]));
  // Shown when linked (so it can be unlinked) or when the server offers it
  const providers = Object.keys(PROVIDERS).filter((id) => linked[id] || methods.available[id]);
  const waysIn = methods.identities.length + (methods.has_password ? 1 : 0);

  function link(provider) {
    setBusy(provider);
    setError("");
    startOAuth(provider, { intent: "link", returnTo: "/settings" }).catch((err) => {
      setError(err.message);
      setBusy(null);
    });
  }

  function unlink() {
    const provider = unlinking;
    setBusy(provider);
    setError("");
    apiFetch(`/me/identities/${provider}`, { method: "DELETE" })
      .then(reload)
      .catch((err) => setError(err.message))
      .finally(() => {
        setBusy(null);
        setUnlinking(null);
      });
  }

  return (
    <section className="stack">
      <h2 className="section-title">🔐 Sign-in methods</h2>
      <Card className="stack">
        {notice && <Alert tone="success" onDismiss={onDismissNotice}>{notice}</Alert>}
        <Alert>{error}</Alert>
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, "--gap": "0.75rem" }}>
          <li className="row" style={{ justifyContent: "space-between" }}>
            <span className="small"><strong>Password</strong>{" "}{methods.has_password ? "Set" : <span className="muted">Not set yet. Add one below.</span>}</span>
          </li>
          {providers.map((id) => {
            const identity = linked[id];
            const name = PROVIDERS[id].name;
            const last = identity && waysIn === 1;
            return (
              <li key={id} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <span className="small">
                  <strong>{name}</strong>{" "}
                  {identity ? (
                    <>
                      Linked{identity.email ? <> as {identity.email}</> : null} <span className="muted">since {formatDate(identity.linked_at)}</span>
                    </>
                  ) : (
                    <span className="muted">Not linked</span>
                  )}
                </span>
                {identity ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null || last}
                    title={last ? `${name} is the only way into this account. Set a password or link another account first.` : undefined}
                    aria-label={`Unlink ${name}`}
                    onClick={() => setUnlinking(id)}
                  >
                    Unlink
                  </Button>
                ) : (
                  <Button size="sm" disabled={busy !== null} aria-label={`Link ${name}`} onClick={() => link(id)}>
                    {busy === id ? "Opening..." : "Link"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {waysIn === 1 && methods.identities.length === 1 && (
          <p className="small muted">You can't unlink your only way to sign in. Set a password or link another account first.</p>
        )}
        {providers.includes("github") && (
          <p className="small muted">Signing in with GitHub is separate from the GitHub connection below, which pushes code to your repositories.</p>
        )}
      </Card>
      {unlinking && (
        <ConfirmDialog
          title={`Unlink ${PROVIDERS[unlinking].name}?`}
          message={`You won't be able to sign in with ${PROVIDERS[unlinking].name} until you link it again.`}
          confirmLabel="Unlink"
          busy={busy !== null}
          onConfirm={unlink}
          onCancel={() => setUnlinking(null)}
        />
      )}
    </section>
  );
}

export default SignInMethodsSection;
