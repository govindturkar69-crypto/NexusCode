import { useRef, useState } from "react";
import { PROVIDERS, startOAuth } from "../api/oauth";
import { useSlowHint, WAKING_TEXT } from "../utils/useSlowHint";
import GithubIcon from "./icons/GithubIcon";
import GoogleIcon from "./icons/GoogleIcon";
import Alert from "./ui/Alert";
import Button from "./ui/Button";

const ORDER = ["google", "github"];
const ICONS = { google: GoogleIcon, github: GithubIcon };

// "Continue with Google / GitHub". Always rendered, straight away and in a fixed
// order: they never wait for the server. If the server says a provider isn't set
// up, its button is disabled in place (nothing moves). A start that takes long
// (a sleeping server) says so in the status line, which keeps its space.
function ProviderButtons({ options, returnTo }) {
  const [busy, setBusy] = useState(null); // { provider, attempt }
  const attempts = useRef(0);
  const [error, setError] = useState("");
  const slow = useSlowHint(busy?.attempt ?? null);
  const unavailable = ORDER.filter((id) => options.known && !options[id]);

  function go(provider) {
    attempts.current += 1;
    setBusy({ provider, attempt: attempts.current });
    setError("");
    // On success the page leaves for the provider, so only failures come back here
    startOAuth(provider, { returnTo }).catch((err) => {
      setError(err.message);
      setBusy(null);
    });
  }

  const status = slow
    ? WAKING_TEXT
    : unavailable.length > 0
      ? `${unavailable.map((id) => PROVIDERS[id].name).join(" and ")} sign-in isn't set up on this server.`
      : "";

  return (
    <div className="provider-buttons">
      <div className="provider-buttons__list">
        {ORDER.map((id) => {
          const Icon = ICONS[id];
          return (
            <Button
              key={id}
              variant="secondary"
              block
              className="provider-button"
              disabled={busy !== null || unavailable.includes(id)}
              loading={busy?.provider === id}
              icon={<Icon size={17} />}
              onClick={() => go(id)}
            >
              {`Continue with ${PROVIDERS[id].name}`}
            </Button>
          );
        })}
      </div>
      <p className="provider-buttons__status small muted" role="status" aria-live="polite">{status}</p>
      <Alert>{error}</Alert>
    </div>
  );
}

export default ProviderButtons;
