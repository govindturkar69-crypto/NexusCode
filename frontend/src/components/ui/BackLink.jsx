import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

// A real link (not a button) so it can be opened in a new tab and is announced as
// navigation.
function BackLink({ to, children }) {
  return (
    <Link to={to} className="back-link">
      <ChevronLeft size={16} aria-hidden="true" />
      {children}
    </Link>
  );
}

export default BackLink;
