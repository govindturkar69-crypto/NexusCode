import { Link } from "react-router-dom";
import NotificationBell from "./NotificationBell";
import ThemeToggle from "./ThemeToggle";

// The controls in the top corner of every signed-in page
function AppBar() {
  return (
    <div className="app-bar">
      <ThemeToggle />
      <NotificationBell />
      <Link className="btn btn--ghost btn--icon" to="/settings" aria-label="Settings">⚙️</Link>
    </div>
  );
}

export default AppBar;
