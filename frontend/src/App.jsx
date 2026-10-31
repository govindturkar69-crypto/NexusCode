import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Projects from "./pages/Projects";
import Board from "./pages/Board";
import AIAssistant from "./pages/AIAssistant";
import CodeEditor from "./pages/CodeEditor";
import Dashboard from "./pages/Dashboard";
import AdminDashboard from "./pages/AdminDashboard";
import VideoMeeting from "./pages/VideoMeeting";
import NotFound from "./pages/NotFound";
import ProtectedRoute from "./components/ProtectedRoute";
import AuthProvider from "./auth/AuthProvider";

const protect = (element) => <ProtectedRoute>{element}</ProtectedRoute>;

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
