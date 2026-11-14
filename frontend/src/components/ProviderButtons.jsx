import { useState } from "react";
import { PROVIDERS, startOAuth } from "../api/oauth";
import GithubIcon from "./icons/GithubIcon";
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
    <div className="stack provider-buttons motion-fade-in" style={{ "--gap": "0.5rem" }}>
      <p className="provider-buttons__or"><span>or</span></p>
      {enabled.map((id) => (
        <Button key={id} variant="secondary" block disabled={busy !== null} loading={busy === id} icon={id === "github" ? <GithubIcon size={16} /> : null} onClick={() => go(id)}>
          {busy === id ? "Opening..." : `Continue with ${PROVIDERS[id].name}`}
        </Button>
      ))}
      {error && <p role="alert" className="small text-danger" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}

export default ProviderButtons;
