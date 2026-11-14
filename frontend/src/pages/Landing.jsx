import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Bot, Code2, KeyRound, LayoutGrid, MessageSquare, Play, Sparkles, Users, Video,
} from "lucide-react";
import GithubIcon from "../components/icons/GithubIcon";
import { FEATURES, PAGE_TITLE, REPO_URL, SHOTS, STACK, STEPS } from "../landing/content";
import { useReveal } from "../motion/useReveal";

const FEATURE_ICONS = {
  board: LayoutGrid, editor: Code2, collab: Users, agent: Bot, ai: Sparkles,
  run: Play, github: GithubIcon, auth: KeyRound, video: Video, chat: MessageSquare,
};

// A section that fades up the first time it scrolls into view
function Reveal({ as: Tag = "section", className = "", children, ...props }) {
  const ref = useReveal();
  return <Tag ref={ref} className={`landing-section ${className}`} {...props}>{children}</Tag>;
}

// Product screenshots in a browser-style frame. Both themes' images are in the
// page but CSS hides one, and lazy images that are hidden are never fetched.
function Showcase() {
  const [active, setActive] = useState(SHOTS[0].id);
  const shot = SHOTS.find((s) => s.id === active);
  return (
    <div className="landing-shot">
      <div className="landing-shot__switch" role="group" aria-label="Screenshot">
        {SHOTS.map((s) => (
          <button key={s.id} type="button" aria-pressed={s.id === active} className={`landing-shot__tab ${s.id === active ? "is-active" : ""}`} onClick={() => setActive(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <figure className="landing-shot__frame">
        <div className="landing-shot__chrome" aria-hidden="true"><span /><span /><span /></div>
        <div className="landing-shot__viewport motion-fade-in" key={shot.id}>
          {["light", "dark"].map((theme) => (
            <img
              key={theme}
              className={`landing-shot__img landing-shot__img--${theme}`}
              src={`/landing/${shot.id}-${theme}.webp`}
              alt={shot.alt}
              width="1280"
              height="800"
              loading="lazy"
              decoding="async"
            />
          ))}
        </div>
      </figure>
    </div>
  );
}

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
      <section className="landing-hero motion-stagger" aria-labelledby="landing-title">
        <p className="landing-hero__badge" style={{ "--i": 0 }}>
          <span className="landing-hero__badge-dot" aria-hidden="true" /> Open source · free to try
        </p>
        <h1 id="landing-title" className="landing-hero__title" style={{ "--i": 1 }}>
          Plan, write, run and ship code <span className="landing-accent">together</span>, in the browser.
        </h1>
        <p className="landing-hero__lead" style={{ "--i": 2 }}>
          NexusCode is a workspace for small software teams: a task board, a shared code editor with live
          collaboration, in-browser runners, an AI coding agent, chat and group video, in one place.
        </p>
        <div className="landing-actions" style={{ "--i": 3 }}>
          <Link className="btn btn--primary btn--lg" to="/login?mode=signup">
            Sign up free<ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link className="btn btn--secondary btn--lg" to="/login">Sign in</Link>
          <a className="btn btn--ghost btn--lg" href={REPO_URL} target="_blank" rel="noopener noreferrer">
            <GithubIcon size={16} />View on GitHub{" "}<span className="visually-hidden">(opens in a new tab)</span>
          </a>
        </div>
        <p className="small muted landing-note" style={{ "--i": 4 }}>
          Runs on free hosting tiers: after a quiet spell, the first request can take up to a minute while the
          server wakes up.
        </p>
      </section>

      <Reveal className="landing-section--shots" aria-label="Screenshots">
        <Showcase />
      </Reveal>

      <Reveal aria-labelledby="features-title">
        <h2 id="features-title">Features</h2>
        <ul className="landing-features">
          {FEATURES.map((feature) => {
            const Icon = FEATURE_ICONS[feature.icon] ?? Sparkles;
            return (
              <li key={feature.title} className="card landing-feature">
                <h3>
                  <span aria-hidden="true" className="landing-feature__icon"><Icon size={18} /></span> {feature.title}
                </h3>
                <p className="muted">{feature.text}</p>
              </li>
            );
          })}
        </ul>
      </Reveal>

      <Reveal aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ol className="landing-steps">
          {STEPS.map((step) => (
            <li key={step.title} className="landing-step">
              <h3>{step.title}</h3>
              <p className="muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </Reveal>

      <Reveal aria-labelledby="stack-title">
        <h2 id="stack-title">Built with</h2>
        <dl className="landing-stack">
          {STACK.map(({ area, items }) => (
            <div key={area} className="landing-stack__row">
              <dt>{area}</dt>
              <dd className="muted">{items}</dd>
            </div>
          ))}
        </dl>
      </Reveal>

      <Reveal className="landing-cta" aria-labelledby="cta-title">
        <h2 id="cta-title">Try it with your team</h2>
        <p className="muted landing-cta__text">Make a project, invite a teammate, and start on the board.</p>
        <div className="landing-actions">
          <Link className="btn btn--primary btn--lg" to="/login?mode=signup">Create an account</Link>
          <Link className="btn btn--secondary btn--lg" to="/login">Sign in</Link>
        </div>
      </Reveal>

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
