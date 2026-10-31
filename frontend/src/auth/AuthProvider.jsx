import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, clearToken, getToken, hasValidToken, setToken } from "../api/client";
import { AuthContext } from "./authContext";

// Holds the logged-in user (from /me) for the whole app.
function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => (hasValidToken() ? getToken() : null));
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch("/me")
      .then((data) => {
        if (!cancelled) setUser(data);
      })
      // A 401 is already handled by apiFetch (redirect to /login)
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);

  const signIn = useCallback((newToken) => {
    setToken(newToken);
    setUser(null);
    setTokenState(newToken);
  }, []);

  const signOut = useCallback(() => {
    clearToken();
    setUser(null);
    setTokenState(null);
  }, []);

  const value = useMemo(
    () => ({ user: token ? user : null, signIn, signOut }),
    [token, user, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthProvider;
