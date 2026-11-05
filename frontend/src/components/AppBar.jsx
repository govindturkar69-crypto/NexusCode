import NotificationBell from "./NotificationBell";

// The controls in the top corner of every signed-in page
function AppBar() {
  return (
    <div className="app-bar">
      <NotificationBell />
    </div>
  );
}

export default AppBar;
