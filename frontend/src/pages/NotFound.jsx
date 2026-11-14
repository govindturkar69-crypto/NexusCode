import { Link } from "react-router-dom";
import { Compass } from "lucide-react";

function NotFound() {
  return (
    <main className="page auth-page">
      <div className="state not-found motion-rise-in">
        <span className="state__icon" aria-hidden="true"><Compass size={26} /></span>
        <p className="not-found__code" aria-hidden="true">404</p>
        <h1 className="state__title not-found__title">Page not found</h1>
        <p className="state__text">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
        <Link to="/projects" className="btn btn--primary">Go to Projects</Link>
      </div>
    </main>
  );
}

export default NotFound;
