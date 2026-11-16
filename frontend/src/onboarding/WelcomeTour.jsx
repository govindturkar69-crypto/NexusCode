import { useEffect, useId, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, X } from "lucide-react";
import Button from "../components/ui/Button";
import Kbd from "../components/ui/Kbd";
import { STEPS, isComplete } from "./tour";
import "../styles/onboarding.css";

// A short getting-started checklist in the corner: five steps, each with one
// button that takes you there. Not modal, so the page stays usable; Escape or
// "Skip tour" closes it, and it can be reopened from the account menu.
// state: { done: [ids], dismissed }; onDone(id); onClose()
function WelcomeTour({ state, project, onDone, onClose, onOpenPalette }) {
  const navigate = useNavigate();
  const titleId = useId();
  const panelRef = useRef(null);
  const doneCount = STEPS.filter((s) => state.done.includes(s.id)).length;
  const complete = isComplete(state);

  // Take focus when it first appears, so keyboard and screen reader users find it
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  const base = project ? `/projects/${project.id}` : null;
  const actions = {
    project: () => navigate("/projects?do=new-project"),
    invite: () => navigate(`${base}?do=invite`),
    editor: () => navigate(`${base}/editor`),
    palette: () => onOpenPalette(),
    meeting: () => navigate(`${base}/meeting`),
  };

  function run(step) {
    onDone(step.id);
    actions[step.id]();
  }

  return (
    <section ref={panelRef} className="tour" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="tour__head">
        <div>
          <h2 id={titleId} className="tour__title">{complete ? "You're all set" : "Welcome to NexusCode"}</h2>
          <p className="tour__progress-text">{doneCount} of {STEPS.length} done</p>
        </div>
        <Button variant="subtle" size="icon" aria-label="Close the welcome tour" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </Button>
      </header>
      <div className="tour__bar" role="progressbar" aria-label="Tour progress" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={doneCount}>
        <span style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
      </div>
      <ol className="tour__steps">
        {STEPS.map((step) => {
          const done = state.done.includes(step.id);
          const blocked = step.needsProject && !project;
          return (
            <li key={step.id} className={`tour__step ${done ? "is-done" : ""}`}>
              <span className="tour__check" aria-hidden="true">{done && <Check size={12} />}</span>
              <div className="tour__body">
                <p className="tour__step-title">
                  {step.title}
                  {done && <span className="visually-hidden"> (done)</span>}
                </p>
                <p className="tour__step-text">
                  {step.text}
                  {step.id === "palette" && <> <Kbd keys={["Mod", "K"]} /></>}
                </p>
                {blocked && !done && <p className="tour__step-text tour__step-text--hint">Create a project first.</p>}
              </div>
              {!done && (
                <Button size="sm" variant={step.id === STEPS.find((s) => !state.done.includes(s.id))?.id ? "primary" : "secondary"} disabled={blocked} onClick={() => run(step)} aria-label={`${step.title}: go`}>
                  Go <ArrowRight size={13} aria-hidden="true" />
                </Button>
              )}
            </li>
          );
        })}
      </ol>
      <footer className="tour__foot">
        <Button variant="link" onClick={onClose}>{complete ? "Close" : "Skip tour"}</Button>
      </footer>
    </section>
  );
}

export default WelcomeTour;
