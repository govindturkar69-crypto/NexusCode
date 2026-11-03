import { Link } from "react-router-dom";

function NotFound() {
  return (
    <main className="page page--centered">
      <div style={{ textAlign: "center" }}>
        <div className="eyebrow eyebrow--danger">$ 404 --not-found</div>
        <h1 className="page-title">Page not found</h1>
        <p className="muted" style={{ margin: "0.5rem 0 1.5rem" }}>
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <Link to="/projects" className="btn btn--primary">Go to Projects</Link>
      </div>
    </main>
  );
}

export default NotFound;
