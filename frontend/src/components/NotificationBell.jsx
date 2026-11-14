import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import { formatMessageTime } from "../projects/chat";
import Button from "./ui/Button";

const POLL_EVERY_MS = 30000;

// Notifications belong to the user rather than a project, and the project
// sockets are only open on a Board, so the bell polls.
function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const container = useRef(null);
  const navigate = useNavigate();

  const refresh = useCallback(() => {
    return apiFetch("/notifications?limit=20")
      .then((data) => {
        setNotifications(data.notifications ?? []);
        setUnread(data.unread_count ?? 0);
        setError("");
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_EVERY_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutsideClick(event) {
      if (!container.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function toggle() {
    if (!open) refresh();
    setOpen(!open);
  }

  function openNotification(notification) {
    setOpen(false);
    navigate(`/projects/${notification.project_id}`);
    if (notification.is_read) return;
    apiFetch(`/notifications/${notification.id}/read`, { method: "POST" })
      .then(refresh)
      .catch((err) => setError(err.message));
  }

  function markAllRead() {
    apiFetch("/notifications/read-all", { method: "POST" })
      .then(refresh)
      .catch((err) => setError(err.message));
  }

  return (
    <div className="bell" ref={container}>
      <Button
        variant="subtle"
        size="icon"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={toggle}
      >
        <Bell size={17} aria-hidden="true" />
        {/* Keyed on the count, so it pops each time a new one arrives */}
        {unread > 0 && <span key={unread} className="bell__count motion-pop" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
      </Button>

      {open && (
        <div className="bell__menu" role="region" aria-label="Notifications">
          <div className="bell__head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <Button variant="link" icon={<CheckCheck size={14} aria-hidden="true" />} onClick={markAllRead}>Mark all as read</Button>
            )}
          </div>
          {error && <p role="alert" className="small text-danger bell__error">{error}</p>}
          {notifications.length === 0 && !error && (
            <div className="bell__empty">
              <Inbox size={22} aria-hidden="true" />
              <p>You're all caught up.</p>
            </div>
          )}
          <ul className="bell__list motion-stagger">
            {notifications.map((notification, i) => (
              <li key={notification.id} style={{ "--i": i }}>
                <button
                  type="button"
                  className={`bell__item ${notification.is_read ? "" : "bell__item--unread"}`}
                  onClick={() => openNotification(notification)}
                >
                  <span className="bell__dot" aria-hidden="true" />
                  <span className="bell__body">
                    {notification.message}
                    {!notification.is_read && <span className="visually-hidden"> (unread)</span>}
                    <time className="bell__time" dateTime={notification.created_at}>
                      {formatMessageTime(notification.created_at)}
                    </time>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
