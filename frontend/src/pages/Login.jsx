import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/useAuth";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";

// Same rules the backend enforces on /signup
const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
const passwordBytes = (value) => new TextEncoder().encode(value).length;

const MODES = {
  signin: { prompt: "$ welcome-back", subtitle: "Sign in to your workspace", submit: "Sign in", busy: "Signing in..." },
  signup: { prompt: "$ create-account", subtitle: "Create your NexusCode account", submit: "Create account", busy: "Creating account..." },
};

function Login() {
  const [mode, setMode] = useState("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();
  // Where ProtectedRoute was sending the user before they were bounced here
  const redirectTo = location.state?.from?.pathname ?? "/projects";
  const isSignup = mode === "signup";
  const copy = MODES[mode];

  function switchMode() {
    setMode(isSignup ? "signin" : "signup");
    setError("");
    setPassword("");
    setConfirmPassword("");
  }

  function validateSignup() {
    if (!USERNAME_PATTERN.test(username)) {
      return "Username must be 3-30 characters using only lowercase letters, numbers and _";
    }
    const bytes = passwordBytes(password);
    if (bytes < 8 || bytes > 72) return "Password must be between 8 and 72 bytes long";
    if (password !== confirmPassword) return "Passwords don't match";
    return "";
  }

  function logIn() {
    const form = new URLSearchParams();
    form.append("username", username);
    form.append("password", password);
    return apiFetch("/login", { method: "POST", form, auth: false }).then((data) => {
      signIn(data.access_token);
      navigate(redirectTo, { replace: true });
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (isSignup) {
      const problem = validateSignup();
      if (problem) {
        setError(problem);
        return;
      }
    }

    setSubmitting(true);
    const request = isSignup
      ? apiFetch("/signup", { method: "POST", body: { username, password }, auth: false }).then(logIn)
      : logIn();

    request
      .catch((err) => setError(!isSignup && err.status === 401 ? "Invalid username or password" : err.message))
      .finally(() => setSubmitting(false));
  }

  return (
    <main className="page page--centered">
      <div className="card" style={{ width: "100%", maxWidth: "380px", padding: "2.5rem", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ marginBottom: "2rem" }}>
          <div className="eyebrow">{copy.prompt}</div>
          <h1 className="page-title" style={{ fontSize: "26px", letterSpacing: "-0.5px" }}>
            Nexus<span style={{ color: "var(--color-accent)" }}>Code</span>
          </h1>
          <p className="muted" style={{ marginTop: "0.5rem" }}>{copy.subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="stack" style={{ "--gap": "1rem" }}>
          <Input
            label="Username"
            placeholder="your_username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            hint={isSignup ? "3-30 characters: lowercase letters, numbers and _" : undefined}
          />
          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={isSignup ? "At least 8 characters" : undefined}
          />
          {isSignup && (
            <Input
              label="Confirm password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          )}

          {error && <p role="alert" className="small text-danger">{error}</p>}

          <Button type="submit" block disabled={submitting}>
            {submitting ? copy.busy : copy.submit}
          </Button>
        </form>

        <p className="muted small" style={{ textAlign: "center", marginTop: "1.5rem" }}>
          {isSignup ? "Already have an account? " : "New to NexusCode? "}
          <Button variant="link" onClick={switchMode}>
            {isSignup ? "Sign in" : "Create an account"}
          </Button>
        </p>
      </div>
    </main>
  );
}

export default Login;
