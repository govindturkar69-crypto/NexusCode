import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Projects from "./pages/Projects";
import Board from "./pages/Board";
import AIAssistant from "./pages/AIAssistant";
import CodeEditor from "./pages/CodeEditor";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:projectId" element={<Board />} />
        <Route path="/ai" element={<AIAssistant />} />
        <Route path="/projects/:projectId/editor" element={<CodeEditor />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;