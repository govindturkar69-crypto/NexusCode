import { Link } from "react-router-dom";
import ThemeToggle from "../ThemeToggle";
import { loadLogin, prefetchOn } from "../../routes/prefetch";

// Header for signed-out pages (landing, sign-in, password reset): the brand, the
// theme toggle and, on the landing page, the way in.
function PublicHeader({ showAuthLinks = false }) {
  return (
    <header className="public-header">
      <Link to="/" className="brand">
        <span className="brand__mark" aria-hidden="true">N</span>
        <span className="brand__name">Nexus<span>Code</span></span>
        <span className="visually-hidden"> home</span>
      </Link>
      <div className="public-header__actions">
        {showAuthLinks && (
          <>
            <Link to="/login" className="btn btn--subtle public-header__signin" {...prefetchOn(loadLogin)}>Sign in</Link>
            <Link to="/login?mode=signup" className="btn btn--primary" {...prefetchOn(loadLogin)}>Sign up</Link>
          </>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}

export default PublicHeader;
