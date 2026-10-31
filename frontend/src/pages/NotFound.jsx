import { Link } from "react-router-dom";

function NotFound() {
  return (
    <div style={{ minHeight: "100vh", background: "#0D1117", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif", padding: "1rem" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", color: "#F85149", marginBottom: "0.4rem" }}>
          $ 404 --not-found
        </div>
        <h1 style={{ fontFamily: "'JetBrains Mono', monospace", color: "#E6EDF3", fontSize: "24px", margin: 0, fontWeight: 600 }}>
          Page not found
        </h1>
        <p style={{ color: "#8B949E", fontSize: "14px", margin: "0.5rem 0 1.5rem" }}>
          The page you're looking for doesn't exist.
        </p>
        <Link to="/projects" style={linkStyle}>Go to Projects</Link>
      </div>
    </div>
  );
}

const linkStyle = {
  display: "inline-block",
  padding: "9px 16px",
  background: "#58A6FF",
  color: "#0D1117",
  borderRadius: "6px",
  fontSize: "14px",
  fontWeight: 600,
  textDecoration: "none",
};

export default NotFound;
