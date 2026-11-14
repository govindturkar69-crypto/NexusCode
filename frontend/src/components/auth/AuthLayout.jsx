import { Bot, LayoutGrid, Users } from "lucide-react";
import "../../styles/auth.css";

// Real features only (see README): a short, honest pitch beside the form
const HIGHLIGHTS = [
  { Icon: LayoutGrid, title: "Plan on a shared board", text: "Tasks with assignees, priorities and due dates, and owner, editor and viewer roles." },
  { Icon: Users, title: "Code together, live", text: "One editor for the whole team, with everyone's cursor and name as they type." },
  { Icon: Bot, title: "An AI agent you review", text: "It reads your files and runs your code, then proposes changes you accept or reject." },
];

// Every sign-in page: the form card, and on wide screens a brand panel beside it.
// The card comes first in the page so screen readers and keyboards reach the form
// first; CSS puts the panel on the left. On tablets and phones only the card shows.
function AuthLayout({ children, label }) {
  return (
    <main className="page auth-page auth-layout">
      <div className="auth-layout__grid">
        <section className="card auth-card" aria-label={label}>
          {children}
        </section>
        <div className="auth-brand">
          <div className="auth-brand__bg" aria-hidden="true" />
          <div className="auth-brand__content motion-stagger">
            <p className="auth-brand__logo" style={{ "--i": 0 }}>
              <span className="brand__mark" aria-hidden="true">N</span>
              <span>NexusCode</span>
            </p>
            <p className="auth-brand__tagline" style={{ "--i": 1 }}>Plan, write, run and ship code together, in the browser.</p>
            <ul className="auth-brand__list">
              {HIGHLIGHTS.map(({ Icon, title, text }, i) => (
                <li key={title} className="auth-brand__item" style={{ "--i": i + 2 }}>
                  <span className="auth-brand__icon" aria-hidden="true"><Icon size={18} /></span>
                  <span>
                    <strong>{title}</strong>
                    <span className="auth-brand__text">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="auth-brand__note" style={{ "--i": 5 }}>Open source, MIT licensed. Your code runs in your browser.</p>
          </div>
        </div>
      </div>
    </main>
  );
}

export default AuthLayout;
