import Modal from "../components/ui/Modal";
import Kbd from "../components/ui/Kbd";
import { GROUPS, SHORTCUTS } from "./shortcuts";

// The "?" overlay: every shortcut, grouped. Loaded on first open.
function ShortcutsDialog({ onClose }) {
  return (
    <Modal title="Keyboard shortcuts" description="Single keys work when you aren't typing in a field or the code editor." onClose={onClose} size="lg">
      <div className="shortcuts">
        {GROUPS.map((group) => (
          <section key={group} className="shortcuts__group" aria-labelledby={`shortcuts-${group}`}>
            <h3 id={`shortcuts-${group}`} className="shortcuts__title">{group}</h3>
            <dl className="shortcuts__list">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} className="shortcuts__row">
                  <dt>{s.label}</dt>
                  <dd><Kbd keys={s.keys} /></dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}

export default ShortcutsDialog;
