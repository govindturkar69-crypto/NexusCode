import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AppBar from "./components/AppBar";
import ProtectedRoute from "./components/ProtectedRoute";
import AuthProvider from "./auth/AuthProvider";

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
const NotFound = lazy(() => import("./pages/NotFound"));

const protect = (element) => (
  <ProtectedRoute>
    <AppBar />
    {element}
  </ProtectedRoute>
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
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/projects" element={protect(<Projects />)} />
            <Route path="/projects/:projectId" element={protect(<Board />)} />
            <Route path="/ai" element={protect(<AIAssistant />)} />
            <Route path="/projects/:projectId/editor" element={protect(<CodeEditor />)} />
            <Route path="/dashboard" element={protect(<Dashboard />)} />
            <Route path="/admin" element={protect(<AdminDashboard />)} />
            <Route path="/projects/:projectId/meeting" element={protect(<VideoMeeting />)} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
