import Button from "./Button";
import Modal from "./Modal";

// "Are you sure?" for destructive actions. Cancel is the default focus, so
// pressing Enter right away doesn't delete anything.
function ConfirmDialog({ title, message, confirmLabel = "Delete", busy = false, onConfirm, onCancel }) {
  return (
    <Modal
      title={title}
      onClose={busy ? () => {} : onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button variant="danger-solid" onClick={onConfirm} disabled={busy}>
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
