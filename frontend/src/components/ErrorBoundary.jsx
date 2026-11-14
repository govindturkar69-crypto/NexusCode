import { Component } from "react";
import { reportError } from "../observability";

// Catches render errors anywhere below it, reports them (if Sentry is on)
// and shows a recovery screen instead of a blank page.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    reportError(error, { componentStack: info?.componentStack });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="page auth-page">
        <div role="alert" className="state state--error not-found">
          <span className="state__icon" aria-hidden="true">
            {/* Inline, so the recovery screen needs nothing else to load */}
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />
            </svg>
          </span>
          <h1 className="state__title not-found__title">Something went wrong</h1>
          <p className="state__text">
            The page hit an unexpected error. Reloading usually fixes it.
          </p>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </div>
      </main>
    );
  }
}

export default ErrorBoundary;
