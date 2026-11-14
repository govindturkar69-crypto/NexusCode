import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { cacheAuthOptions, cleanAuthOptions, initialAuthOptions } from "./authOptions";

// What sign-in options this server offers. Starts from the last answer this
// browser saw (or "everything") so the page renders complete at once; `known`
// turns true when the server has confirmed. A failed request keeps the
// optimistic values: starting a sign-in then explains what's wrong.
export function useAuthOptions() {
  const [options, setOptions] = useState(initialAuthOptions);
  useEffect(() => {
    let cancelled = false;
    apiFetch("/auth/options", { auth: false })
      .then((data) => {
        cacheAuthOptions(data);
        if (!cancelled) setOptions({ ...cleanAuthOptions(data), known: true });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return options;
}
