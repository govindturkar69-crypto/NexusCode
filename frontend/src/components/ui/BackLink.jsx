import { Link } from "react-router-dom";

// A real link (not a button) so it can be opened in a new tab and is
// announced as navigation.
function BackLink({ to, children }) {
  return (
    <Link to={to} className="btn btn--link">
      ← {children}
    </Link>
  );
}

export default BackLink;
