import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";

// The account's ways in: its password and linked Google / GitHub accounts.
// Loaded once by Settings and shared with the password section.
export function useSignInMethods() {
  const [methods, setMethods] = useState(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    return apiFetch("/me/sign-in-methods")
      .then((data) => {
        setMethods(data);
        setError("");
      })
      .catch((err) => setError(err.message));
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { methods, error, reload };
}
