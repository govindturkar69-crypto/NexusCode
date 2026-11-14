import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useAuthOptions } from "../auth/useAuthOptions";
import AuthLayout from "../components/auth/AuthLayout";
import PasswordStrength from "../components/auth/PasswordStrength";
import ProviderButtons from "../components/ProviderButtons";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import { useSlowHint, WAKING_TEXT } from "../utils/useSlowHint";

// Same rules the backend enforces on /signup
const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
const passwordBytes = (value) => new TextEncoder().encode(value).length;

const MODES = {
  signin: { title: "Welcome back", subtitle: "Sign in to your NexusCode workspace.", submit: "Sign in", busy: "Signing in...", label: "Sign in" },
  signup: { title: "Create your account", subtitle: "Boards, chat and a shared editor for your team.", submit: "Create account", busy: "Creating account...", label: "Create an account" },
};

// Each field's own rule, so it can be checked when you leave it
const CHECKS = {
  username: (v, signup) => {
    if (!v.trim()) return "Enter your username.";
    return signup && !USERNAME_PATTERN.test(v) ? "Username must be 3-30 characters using only lowercase letters, numbers and _" : null;
  },
  password: (v, signup) => {
    if (!v) return "Enter your password.";
    const bytes = passwordBytes(v);
    return signup && (bytes < 8 || bytes > 72) ? "Password must be between 8 and 72 bytes long" : null;
  },
};

function Login() {
  const location = useLocation();
  const navigate = useNavigate();
  // /login?mode=signup (e.g. from the landing page) opens the sign-up form
  const [mode, setMode] = useState(() => (new URLSearchParams(location.search).get("mode") === "signup" ? "signup" : "signin"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const options = useAuthOptions();
  const [error, setError] = useState("");
  // One inline problem at a time, shown on the field it belongs to
  const [fieldError, setFieldError] = useState(null); // { field, message }
  const [submittedAt, setSubmittedAt] = useState(null);
  const submitting = submittedAt !== null;
  // A sleeping server can take up to a minute: say so instead of seeming stuck
  const slow = useSlowHint(submittedAt);
  const { signIn } = useAuth();
  // Where ProtectedRoute was sending the user before they were bounced here
  const redirectTo = location.state?.from?.pathname ?? "/projects";
  const isSignup = mode === "signup";
  const copy = MODES[mode];
  // Email can be used unless the server has said it's off
  const emailOff = options.known && !options.email;

  function switchMode() {
    const next = isSignup ? "signin" : "signup";
    setMode(next);
    setError("");
    setFieldError(null);
    setPassword("");
    setConfirmPassword("");
    // Keep the address bar in step (a reload stays on this form), without a reload
    navigate(next === "signup" ? "/login?mode=signup" : "/login", { replace: true, state: location.state });
  }

  function validate() {
    const username_problem = CHECKS.username(username, isSignup);
    if (username_problem) return { field: "username", message: username_problem };
    const password_problem = CHECKS.password(password, isSignup);
    if (password_problem) return { field: "password", message: password_problem };
    if (isSignup && password !== confirmPassword) return { field: "confirm", message: "Passwords don't match" };
    return null;
  }

  // Leaving a sign-up field with a problem in it shows the problem then and there
  function checkOnBlur(field, value) {
    if (!isSignup || !value || fieldError) return;
    const message = field === "confirm"
      ? (password && value !== password ? "Passwords don't match" : null)
      : CHECKS[field](value, true);
    if (message) setFieldError({ field, message });
  }

  const errorFor = (field) => (fieldError?.field === field ? fieldError.message : undefined);
  // Typing in the field with the problem clears it
  const edit = (field, setter) => (e) => {
    setter(e.target.value);
    if (fieldError?.field === field) setFieldError(null);
  };

  function logIn() {
    const form = new URLSearchParams();
    form.append("username", username);
    form.append("password", password);
    return apiFetch("/login", { method: "POST", form, auth: false }).then((data) => {
      signIn(data.access_token);
      navigate(redirectTo, { replace: true });
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setFieldError(null);

    const problem = validate();
    if (problem) {
      setFieldError(problem);
      document.getElementById(`auth-${problem.field}`)?.focus();
      return;
    }

    setSubmittedAt(Date.now());
    const sendEmail = !emailOff && email.trim();
    const request = isSignup
      ? apiFetch("/signup", { method: "POST", body: sendEmail ? { username, password, email } : { username, password }, auth: false }).then(logIn)
      : logIn();

    request
      .catch((err) => setError(!isSignup && err.status === 401 ? "Invalid username or password" : err.message))
      .finally(() => setSubmittedAt(null));
  }

  return (
    <AuthLayout label={copy.label}>
      <div className="auth-card__body motion-stagger">
        {/* The header and form are keyed by mode, so switching between sign in and
            sign up replays their entrance instead of jumping. The provider buttons
            stay mounted: they're the same on both. */}
        <header key={`${mode}-header`} className="auth-card__header" style={{ "--i": 0 }}>
          <span className="brand__mark auth-card__mark" aria-hidden="true">N</span>
          <h1 className="auth-card__title">{copy.title}</h1>
          <p className="muted auth-card__subtitle">{copy.subtitle}</p>
        </header>

        <div style={{ "--i": 1 }}>
          <ProviderButtons options={options} returnTo={redirectTo} />
        </div>

        <p className="auth-divider" style={{ "--i": 2 }}><span>or with your username</span></p>

        <form key={`${mode}-form`} onSubmit={handleSubmit} noValidate className="stack auth-form" style={{ "--gap": "1rem", "--i": 3 }}>
          <Input
            id="auth-username"
            label="Username"
            placeholder="your_username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={edit("username", setUsername)}
            onBlur={(e) => checkOnBlur("username", e.target.value)}
            error={errorFor("username")}
            hint={isSignup ? "3-30 characters: lowercase letters, numbers and _" : undefined}
          />
          <div className="stack" style={{ "--gap": "0.4rem" }}>
            <Input
              id="auth-password"
              label="Password"
              type="password"
              placeholder="••••••••"
              autoComplete={isSignup ? "new-password" : "current-password"}
              value={password}
              onChange={edit("password", setPassword)}
              onBlur={(e) => checkOnBlur("password", e.target.value)}
              error={errorFor("password")}
            />
            {isSignup && <PasswordStrength value={password} />}
            {!isSignup && (
              // The space is kept even when email is off, so nothing below moves
              <p className="small auth-card__forgot">
                {emailOff
                  ? <span aria-hidden="true">&nbsp;</span>
                  : <Link to="/forgot-password" className="btn btn--link">Forgot password?</Link>}
              </p>
            )}
          </div>
          {isSignup && (
            <Input
              id="auth-confirm"
              label="Confirm password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={edit("confirm", setConfirmPassword)}
              onBlur={(e) => checkOnBlur("confirm", e.target.value)}
              error={errorFor("confirm")}
            />
          )}
          {isSignup && (
            <Input
              label="Email (optional)"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={emailOff ? "" : email}
              disabled={emailOff}
              onChange={(e) => setEmail(e.target.value)}
              hint={emailOff ? "Email isn't set up on this server, so this can't be used yet." : "For password reset. We'll send a link to confirm it."}
            />
          )}

          <Alert>{error}</Alert>

          <Button type="submit" block size="lg" loading={submitting}>
            {submitting ? copy.busy : copy.submit}
          </Button>
          <p className="small muted auth-form__status" role="status" aria-live="polite">{slow ? WAKING_TEXT : ""}</p>
        </form>

        <p className="muted small auth-card__switch" style={{ "--i": 4 }}>
          {isSignup ? "Already have an account? " : "New to NexusCode? "}
          <Button variant="link" onClick={switchMode}>
            {isSignup ? "Sign in" : "Create an account"}
          </Button>
        </p>
      </div>
    </AuthLayout>
  );
}

export default Login;
