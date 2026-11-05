import { useState } from "react";
import { apiFetch } from "../api/client";
import Button from "./ui/Button";
import Card from "./ui/Card";
import ConfirmDialog from "./ui/ConfirmDialog";
import Input from "./ui/Input";
import RoleBadge from "./RoleBadge";

const ROLES = ["viewer", "editor", "owner"];

// List, add, change role, remove, leave. Owners manage everyone; other members
// see the list and can leave. onChanged reloads members and the user's own role.
function MembersPanel({ projectId, members, currentUserId, isOwner, onChanged, onLeft }) {
  const [username, setUsername] = useState("");
  const [newRole, setNewRole] = useState("editor");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toRemove, setToRemove] = useState(null);

  function addMember(event) {
    event.preventDefault();
    const name = username.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    apiFetch(`/projects/${projectId}/members`, { method: "POST", body: { username: name, role: newRole } })
      .then(() => {
        setUsername("");
        return onChanged();
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }

  function changeRole(member, role) {
    setError("");
    apiFetch(`/projects/${projectId}/members/${member.user_id}`, { method: "PATCH", body: { role } })
      .then(() => onChanged())
      .catch((err) => setError(err.message));
  }

  function confirmRemove() {
    const leaving = toRemove.user_id === currentUserId;
    setBusy(true);
    setError("");
    apiFetch(`/projects/${projectId}/members/${toRemove.user_id}`, { method: "DELETE" })
      .then(() => (leaving ? onLeft() : onChanged()))
      .catch((err) => setError(err.message))
      .finally(() => {
        setBusy(false);
        setToRemove(null);
      });
  }

  const removingSelf = toRemove?.user_id === currentUserId;

  return (
    <section aria-labelledby="members-title">
      <h2 id="members-title" className="section-title">👥 Members ({members.length})</h2>
      <Card>
        {isOwner && (
          <form onSubmit={addMember} className="row" style={{ marginBottom: "1rem" }}>
            <Input
              label="Add a member by username"
              hideLabel
              placeholder="Add by username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              className="grow"
            />
            <label className="visually-hidden" htmlFor="new-member-role">Role for the new member</label>
            <select id="new-member-role" className="input" style={{ width: "auto" }} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
            <Button type="submit" disabled={busy || !username.trim()}>Add</Button>
          </form>
        )}

        {error && <p role="alert" className="small text-danger" style={{ marginBottom: "0.75rem" }}>{error}</p>}

        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, "--gap": "0.5rem" }}>
          {members.map((member) => {
            const isMe = member.user_id === currentUserId;
            return (
              <li key={member.user_id} className="card card--inset row row--between">
                <span className="small">{member.username}{isMe && " (you)"}</span>
                <span className="row" style={{ "--gap": "0.5rem" }}>
                  {isOwner ? (
                    <>
                      <label className="visually-hidden" htmlFor={`role-${member.user_id}`}>Role of {member.username}</label>
                      <select
                        id={`role-${member.user_id}`}
                        className="input input--sm"
                        value={member.role}
                        onChange={(e) => changeRole(member, e.target.value)}
                      >
                        {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                      </select>
                    </>
                  ) : (
                    <RoleBadge role={member.role} />
                  )}
                  {(isOwner || isMe) && (
                    <Button
                      variant="danger"
                      size="sm"
                      aria-label={isMe ? "Leave this project" : `Remove ${member.username}`}
                      onClick={() => setToRemove(member)}
                    >
                      {isMe ? "Leave" : "Remove"}
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      {toRemove && (
        <ConfirmDialog
          title={removingSelf ? "Leave this project?" : `Remove ${toRemove.username}?`}
          message={removingSelf ? "You will lose access to this project." : `${toRemove.username} will lose access to this project. Their chat messages stay.`}
          confirmLabel={removingSelf ? "Leave" : "Remove"}
          busy={busy}
          onConfirm={confirmRemove}
          onCancel={() => setToRemove(null)}
        />
      )}
    </section>
  );
}

export default MembersPanel;
