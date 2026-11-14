import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import AuthProvider from "./auth/AuthProvider";
import ThemeProvider from "./theme/ThemeProvider";
import HomeRoute from "./components/HomeRoute";
import AppShell from "./components/shell/AppShell";
import PublicHeader from "./components/shell/PublicHeader";
import { ToastProvider } from "./components/ui/Toast";
import Spinner from "./components/ui/Spinner";
import { loadAccountPages, loadLogin } from "./routes/prefetch";

// Every page is its own chunk, so e.g. Monaco and Recharts only download
// when their pages are opened.
const Login = lazy(loadLogin);
const Projects = lazy(() => import("./pages/Projects"));
const Board = lazy(() => import("./pages/Board"));
const AIAssistant = lazy(() => import("./pages/AIAssistant"));
const CodeEditor = lazy(() => import("./pages/CodeEditor"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const VideoMeeting = lazy(() => import("./pages/VideoMeeting"));
const Settings = lazy(() => import("./pages/Settings"));
const ForgotPassword = lazy(() => loadAccountPages().then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => loadAccountPages().then((m) => ({ default: m.ResetPassword })));
const VerifyEmail = lazy(() => loadAccountPages().then((m) => ({ default: m.VerifyEmail })));
const OAuthCallback = lazy(() => loadAccountPages().then((m) => ({ default: m.OAuthCallback })));
const NotFound = lazy(() => import("./pages/NotFound"));

// Pages anyone can open: the public header (brand + theme toggle), then the page,
// fading in on each route change
function SignedOut({ children }) {
  const { pathname } = useLocation();
  return (
    <>
      <PublicHeader />
      <div key={pathname} className="page-transition">{children}</div>
    </>
  );
}

function PageLoading() {
  return (
    <main className="page page-loading">
      <Spinner size={20} label="Loading…" />
    </main>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <ToastProvider>
            <Suspense fallback={<PageLoading />}>
              <Routes>
                <Route path="/" element={<HomeRoute />} />
                <Route path="/login" element={<SignedOut><Login /></SignedOut>} />
                <Route path="/forgot-password" element={<SignedOut><ForgotPassword /></SignedOut>} />
                <Route path="/reset-password" element={<SignedOut><ResetPassword /></SignedOut>} />
                <Route path="/verify-email" element={<SignedOut><VerifyEmail /></SignedOut>} />
                <Route path="/oauth/callback" element={<SignedOut><OAuthCallback /></SignedOut>} />
                {/* Signed-in pages share one persistent shell (sidebar, header) */}
                <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
                  <Route path="/projects" element={<Projects />} />
                  <Route path="/projects/:projectId" element={<Board />} />
                  <Route path="/ai" element={<AIAssistant />} />
                  <Route path="/projects/:projectId/editor" element={<CodeEditor />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/admin" element={<AdminDashboard />} />
                  <Route path="/projects/:projectId/meeting" element={<VideoMeeting />} />
                  <Route path="/settings" element={<Settings />} />
                </Route>
                <Route path="*" element={<SignedOut><NotFound /></SignedOut>} />
              </Routes>
            </Suspense>
          </ToastProvider>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
