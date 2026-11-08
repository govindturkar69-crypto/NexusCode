import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AppBar from "./components/AppBar";
import ProtectedRoute from "./components/ProtectedRoute";
import ThemeToggle from "./components/ThemeToggle";
import AuthProvider from "./auth/AuthProvider";
import ThemeProvider from "./theme/ThemeProvider";

// Every page is its own chunk, so e.g. Monaco and Recharts only download
// when their pages are opened.
const Login = lazy(() => import("./pages/Login"));
const Projects = lazy(() => import("./pages/Projects"));
const Board = lazy(() => import("./pages/Board"));
const AIAssistant = lazy(() => import("./pages/AIAssistant"));
const CodeEditor = lazy(() => import("./pages/CodeEditor"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const VideoMeeting = lazy(() => import("./pages/VideoMeeting"));
const Settings = lazy(() => import("./pages/Settings"));
const ForgotPassword = lazy(() => import("./pages/AccountPages").then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import("./pages/AccountPages").then((m) => ({ default: m.ResetPassword })));
const VerifyEmail = lazy(() => import("./pages/AccountPages").then((m) => ({ default: m.VerifyEmail })));
const OAuthCallback = lazy(() => import("./pages/AccountPages").then((m) => ({ default: m.OAuthCallback })));
const NotFound = lazy(() => import("./pages/NotFound"));

const protect = (element) => (
  <ProtectedRoute>
    <AppBar />
    {element}
  </ProtectedRoute>
);

// Pages anyone can open, with the theme toggle but not the signed-in controls
const signedOut = (element) => (
  <>
    <div className="app-bar"><ThemeToggle /></div>
    {element}
  </>
);

function PageLoading() {
  return (
    <main className="page">
      <p role="status" className="muted" style={{ padding: "3rem" }}>Loading...</p>
    </main>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<Navigate to="/projects" replace />} />
              <Route
                path="/login"
                element={
                  <>
                    <div className="app-bar"><ThemeToggle /></div>
                    <Login />
                  </>
                }
              />
              <Route path="/forgot-password" element={signedOut(<ForgotPassword />)} />
              <Route path="/reset-password" element={signedOut(<ResetPassword />)} />
              <Route path="/verify-email" element={signedOut(<VerifyEmail />)} />
              <Route path="/oauth/callback" element={signedOut(<OAuthCallback />)} />
              <Route path="/projects" element={protect(<Projects />)} />
              <Route path="/projects/:projectId" element={protect(<Board />)} />
              <Route path="/ai" element={protect(<AIAssistant />)} />
              <Route path="/projects/:projectId/editor" element={protect(<CodeEditor />)} />
              <Route path="/dashboard" element={protect(<Dashboard />)} />
              <Route path="/admin" element={protect(<AdminDashboard />)} />
              <Route path="/projects/:projectId/meeting" element={protect(<VideoMeeting />)} />
              <Route path="/settings" element={protect(<Settings />)} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
