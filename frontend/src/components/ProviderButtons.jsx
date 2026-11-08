import { useState } from "react";
import { PROVIDERS, startOAuth } from "../api/oauth";
import Button from "./ui/Button";

// "Continue with Google" and friends, for the providers this server has set up.
function ProviderButtons({ options, returnTo }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const enabled = Object.keys(PROVIDERS).filter((id) => options[id]);
  if (enabled.length === 0) return null;

  function go(provider) {
    setBusy(provider);
    setError("");
    // On success the page leaves for the provider, so only failures come back here
    startOAuth(provider, { returnTo }).catch((err) => {
      setError(err.message);
      setBusy(null);
    });
  }

  return (
    <div className="stack" style={{ "--gap": "0.5rem" }}>
      <p className="muted small" style={{ textAlign: "center", margin: 0 }}>or</p>
      {enabled.map((id) => (
        <Button key={id} variant="ghost" block disabled={busy !== null} onClick={() => go(id)}>
          {busy === id ? "Opening..." : `Continue with ${PROVIDERS[id].name}`}
        </Button>
      ))}
      {error && <p role="alert" className="small text-danger" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}

export default ProviderButtons;
