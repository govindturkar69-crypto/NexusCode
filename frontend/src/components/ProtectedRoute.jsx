import { Navigate, useLocation } from "react-router-dom";
import { clearToken, hasValidToken } from "../api/client";

// Sends signed-out (or expired) users to /login, remembering where they were going.
function ProtectedRoute({ children }) {
  const location = useLocation();
  if (!hasValidToken()) {
    clearToken();
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

export default ProtectedRoute;
