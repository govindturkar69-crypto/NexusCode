import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";

const NONE = { email: false, google: false, github: false };

// What sign-in options this server offers. Off until known, so nothing is shown
// that would then fail.
export function useAuthOptions() {
  const [options, setOptions] = useState(NONE);
  useEffect(() => {
    let cancelled = false;
    apiFetch("/auth/options", { auth: false })
      .then((data) => {
        if (!cancelled) setOptions({ ...NONE, ...data });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return options;
}
