import Button from "./Button";
import Modal from "./Modal";

// "Are you sure?" for destructive or far-reaching actions. Cancel is the default
// focus, so pressing Enter right away doesn't do anything. tone "primary" is for
// actions that change things but lose nothing (e.g. restoring a version).
function ConfirmDialog({ title, message, confirmLabel = "Delete", busy = false, tone = "danger", onConfirm, onCancel }) {
  return (
    <Modal
      title={title}
      onClose={busy ? () => {} : onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button variant={tone === "primary" ? "primary" : "danger-solid"} onClick={onConfirm} loading={busy}>
            {busy ? "Working..." : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="muted">{message}</p>
    </Modal>
  );
}

export default ConfirmDialog;
