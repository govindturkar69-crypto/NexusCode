import { useState } from "react";
import { useNavigate } from "react-router-dom";

function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  function handleLogin(e) {
    e.preventDefault();
    setError("");

    const formData = new URLSearchParams();
    formData.append("username", username);
    formData.append("password", password);

    fetch("http://127.0.0.1:8000/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Invalid username or password");
        return res.json();
      })
      .then((data) => {
        localStorage.setItem("token", data.access_token);
        navigate("/projects");
      })
      .catch((err) => setError(err.message));
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

          <button type="submit" style={buttonStyle}>
            Sign in
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