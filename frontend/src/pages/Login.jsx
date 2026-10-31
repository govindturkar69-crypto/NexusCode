import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/useAuth";

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
    <div
      style={{
        minHeight: "100vh",
        background: "#0D1117",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', system-ui, sans-serif",
        padding: "1rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "380px",
          background: "#161B22",
          border: "1px solid #30363D",
          borderRadius: "12px",
          padding: "2.5rem",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ marginBottom: "2rem" }}>
          <div
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: "13px",
              color: "#58A6FF",
              marginBottom: "0.4rem",
              letterSpacing: "0.5px",
            }}
          >
            {copy.prompt}
          </div>
          <h1
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: "26px",
              color: "#E6EDF3",
              margin: 0,
              fontWeight: 600,
              letterSpacing: "-0.5px",
            }}
          >
            Nexus<span style={{ color: "#58A6FF" }}>Code</span>
          </h1>
          <p style={{ color: "#8B949E", fontSize: "14px", marginTop: "0.5rem" }}>
            {copy.subtitle}
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="login-username" style={labelStyle}>
              Username
            </label>
            <input
              id="login-username"
              type="text"
              placeholder="your_username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={inputStyle}
            />
            {isSignup && (
              <p style={hintStyle}>3-30 characters: lowercase letters, numbers and _</p>
            )}
          </div>

          <div style={{ marginBottom: isSignup ? "1rem" : "1.5rem" }}>
            <label htmlFor="login-password" style={labelStyle}>
              Password
            </label>
            <input
              id="login-password"
              type="password"
              placeholder="••••••••"
              autoComplete={isSignup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
            {isSignup && <p style={hintStyle}>At least 8 characters</p>}
          </div>

          {isSignup && (
            <div style={{ marginBottom: "1.5rem" }}>
              <label htmlFor="login-confirm-password" style={labelStyle}>
                Confirm password
              </label>
              <input
                id="login-confirm-password"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={inputStyle}
              />
            </div>
          )}

          {error && (
            <p role="alert" style={{ color: "#F85149", fontSize: "13px", marginBottom: "1rem" }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? copy.busy : copy.submit}
          </button>
        </form>

        <p style={{ color: "#8B949E", fontSize: "13px", textAlign: "center", marginTop: "1.5rem", marginBottom: 0 }}>
          {isSignup ? "Already have an account? " : "New to NexusCode? "}
          <button type="button" onClick={switchMode} style={linkButtonStyle}>
            {isSignup ? "Sign in" : "Create an account"}
          </button>
        </p>
      </div>
    </div>
  );
}

const labelStyle = {
  display: "block",
  color: "#8B949E",
  fontSize: "13px",
  marginBottom: "0.4rem",
};

const hintStyle = {
  color: "#6E7681",
  fontSize: "12px",
  margin: "0.35rem 0 0",
};

const linkButtonStyle = {
  background: "none",
  border: "none",
  padding: 0,
  color: "#58A6FF",
  fontSize: "13px",
  cursor: "pointer",
};

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  background: "#0D1117",
  border: "1px solid #30363D",
  borderRadius: "6px",
  color: "#E6EDF3",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
};

const buttonStyle = {
  width: "100%",
  padding: "10px",
  background: "#58A6FF",
  color: "#0D1117",
  border: "none",
  borderRadius: "6px",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
};

export default Login;
