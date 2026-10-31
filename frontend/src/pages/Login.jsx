import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch, setToken } from "../api/client";

function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  // Where ProtectedRoute was sending the user before they were bounced here
  const redirectTo = location.state?.from?.pathname ?? "/projects";

  function handleLogin(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const form = new URLSearchParams();
    form.append("username", username);
    form.append("password", password);

    apiFetch("/login", { method: "POST", form, auth: false })
      .then((data) => {
        setToken(data.access_token);
        navigate(redirectTo, { replace: true });
      })
      .catch((err) => setError(err.status === 401 ? "Invalid username or password" : err.message))
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
            $ welcome-back
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
            Sign in to your workspace
          </p>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: "1rem" }}>
            <label
              style={{
                display: "block",
                color: "#8B949E",
                fontSize: "13px",
                marginBottom: "0.4rem",
              }}
            >
              Username
            </label>
            <input
              type="text"
              placeholder="govind"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label
              style={{
                display: "block",
                color: "#8B949E",
                fontSize: "13px",
                marginBottom: "0.4rem",
              }}
            >
              Password
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
          </div>

          {error && (
            <p style={{ color: "#F85149", fontSize: "13px", marginBottom: "1rem" }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

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