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
      <main className="page page--centered">
        <div role="alert" style={{ textAlign: "center" }}>
          <div className="eyebrow eyebrow--danger">$ unexpected-error</div>
          <h1 className="page-title">Something went wrong</h1>
          <p className="muted" style={{ margin: "0.5rem 0 1.5rem" }}>
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
