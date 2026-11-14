import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useAuthOptions } from "../auth/useAuthOptions";
import ProviderButtons from "../components/ProviderButtons";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";

// Same rules the backend enforces on /signup
const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
const passwordBytes = (value) => new TextEncoder().encode(value).length;

const MODES = {
  signin: { title: "Welcome back", subtitle: "Sign in to your NexusCode workspace.", submit: "Sign in", busy: "Signing in..." },
  signup: { title: "Create your account", subtitle: "Boards, chat and a shared editor for your team.", submit: "Create account", busy: "Creating account..." },
};

function Login() {
  const location = useLocation();
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
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { signIn } = useAuth();
  // Where ProtectedRoute was sending the user before they were bounced here
  const redirectTo = location.state?.from?.pathname ?? "/projects";
  const isSignup = mode === "signup";
  const copy = MODES[mode];

  function switchMode() {
    setMode(isSignup ? "signin" : "signup");
    setError("");
    setFieldError(null);
    setPassword("");
    setConfirmPassword("");
  }

  function validateSignup() {
    if (!USERNAME_PATTERN.test(username)) {
      return { field: "username", message: "Username must be 3-30 characters using only lowercase letters, numbers and _" };
    }
    const bytes = passwordBytes(password);
    if (bytes < 8 || bytes > 72) return { field: "password", message: "Password must be between 8 and 72 bytes long" };
    if (password !== confirmPassword) return { field: "confirm", message: "Passwords don't match" };
    return null;
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

    if (isSignup) {
      const problem = validateSignup();
      if (problem) {
        setFieldError(problem);
        document.getElementById(`auth-${problem.field}`)?.focus();
        return;
      }
    }

    setSubmitting(true);
    const request = isSignup
      ? apiFetch("/signup", { method: "POST", body: email.trim() ? { username, password, email } : { username, password }, auth: false }).then(logIn)
      : logIn();

    request
      .catch((err) => setError(!isSignup && err.status === 401 ? "Invalid username or password" : err.message))
      .finally(() => setSubmitting(false));
  }

  return (
    <main className="page auth-page">
      <div className="card auth-card motion-rise-in">
        <header className="auth-card__header">
          <span className="brand__mark auth-card__mark" aria-hidden="true">N</span>
          <h1 className="auth-card__title">{copy.title}</h1>
          <p className="muted auth-card__subtitle">{copy.subtitle}</p>
        </header>

        <form onSubmit={handleSubmit} noValidate className="stack" style={{ "--gap": "1rem" }}>
          <Input
            id="auth-username"
            label="Username"
            placeholder="your_username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={edit("username", setUsername)}
            error={errorFor("username")}
            hint={isSignup ? "3-30 characters: lowercase letters, numbers and _" : undefined}
          />
          <Input
            id="auth-password"
            label="Password"
            type="password"
            placeholder="••••••••"
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={edit("password", setPassword)}
            error={errorFor("password")}
            hint={isSignup ? "At least 8 characters" : undefined}
          />
          {isSignup && options.email && (
            <Input
              label="Email (optional)"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              hint="For password reset. We'll send a link to confirm it."
            />
          )}
          {isSignup && (
            <Input
              id="auth-confirm"
              label="Confirm password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={edit("confirm", setConfirmPassword)}
              error={errorFor("confirm")}
            />
          )}

          <Alert>{error}</Alert>

          <Button type="submit" block loading={submitting}>
            {submitting ? copy.busy : copy.submit}
          </Button>
          {!isSignup && options.email && (
            <p className="small auth-card__forgot">
              <Link to="/forgot-password" className="btn btn--link">Forgot password?</Link>
            </p>
          )}
        </form>

        <ProviderButtons options={options} returnTo={redirectTo} />

        <p className="muted small auth-card__switch">
          {isSignup ? "Already have an account? " : "New to NexusCode? "}
          <Button variant="link" onClick={switchMode}>
            {isSignup ? "Sign in" : "Create an account"}
          </Button>
        </p>
      </div>
    </main>
  );
}

export default Login;
