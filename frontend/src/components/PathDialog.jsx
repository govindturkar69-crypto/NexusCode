import { useState } from "react";
import Button from "./ui/Button";
import Input from "./ui/Input";
import Modal from "./ui/Modal";

// Asks for a file or folder path. onSubmit returns a promise; a rejection shows
// its message and leaves the dialog open, so the name can be corrected.
function PathDialog({ title, label, initial = "", hint, submitLabel, onSubmit, onClose }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function submit(event) {
    event.preventDefault();
    const path = value.trim();
    if (!path) return;
    setBusy(true);
    setError("");
    onSubmit(path).catch((err) => {
      setError(err.message);
      setBusy(false);
    });
  }

  return (
    <Modal title={title} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="stack" noValidate>
        <Input label={label} value={value} onChange={(e) => setValue(e.target.value)} hint={hint} autoComplete="off" />
        {error && <p role="alert" className="small text-danger">{error}</p>}
        <div className="modal__actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !value.trim()}>{busy ? "Working..." : submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default PathDialog;
