import { useEffect } from "react";
import { Link } from "react-router-dom";
import { FEATURES, PAGE_TITLE, REPO_URL, STACK, STEPS } from "../landing/content";

function Landing() {
  useEffect(() => {
    const previous = document.title;
    document.title = PAGE_TITLE;
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <main className="landing">
      <section className="landing-hero" aria-labelledby="landing-title">
        <p className="eyebrow">$ nexuscode --together</p>
        <h1 id="landing-title" className="landing-hero__title">
          Plan, write, run and ship code <span className="landing-accent">together</span>, in the browser.
        </h1>
        <p className="landing-hero__lead">
          NexusCode is a workspace for small software teams: a task board, a shared code editor with live
          collaboration, in-browser runners, an AI coding agent, chat and group video, in one place.
        </p>
        <div className="landing-actions">
          <Link className="btn btn--primary" to="/login?mode=signup">Sign up free</Link>
          <Link className="btn btn--ghost" to="/login">Sign in</Link>
          <a className="btn btn--ghost" href={REPO_URL} target="_blank" rel="noopener noreferrer">
            View on GitHub{" "}<span className="visually-hidden">(opens in a new tab)</span>
          </a>
        </div>
        <p className="small muted landing-note">
          Runs on free hosting tiers: after a quiet spell, the first request can take up to a minute while the
          server wakes up.
        </p>
      </section>

      <section className="landing-section" aria-labelledby="features-title">
        <h2 id="features-title">Features</h2>
        <ul className="landing-features">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="card landing-feature">
              <h3>
                <span aria-hidden="true" className="landing-feature__icon">{feature.icon}</span> {feature.title}
              </h3>
              <p className="muted">{feature.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-section" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ol className="landing-steps">
          {STEPS.map((step) => (
            <li key={step.title} className="landing-step">
              <h3>{step.title}</h3>
              <p className="muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section" aria-labelledby="stack-title">
        <h2 id="stack-title">Built with</h2>
        <dl className="landing-stack">
          {STACK.map(({ area, items }) => (
            <div key={area} className="landing-stack__row">
              <dt>{area}</dt>
              <dd className="muted">{items}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="landing-section landing-cta" aria-labelledby="cta-title">
        <h2 id="cta-title">Try it with your team</h2>
        <div className="landing-actions">
          <Link className="btn btn--primary" to="/login?mode=signup">Create an account</Link>
          <Link className="btn btn--ghost" to="/login">Sign in</Link>
        </div>
      </section>

      <footer className="landing-footer small muted">
        <span>NexusCode is open source under the MIT License.</span>{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          Source code on GitHub{" "}<span className="visually-hidden">(opens in a new tab)</span>
        </a>
      </footer>
    </main>
  );
}

export default Landing;
