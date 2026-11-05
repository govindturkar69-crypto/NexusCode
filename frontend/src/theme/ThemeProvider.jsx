import { useCallback, useEffect, useMemo, useState } from "react";
import { tokenSubject } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { applyTheme, storedTheme, storeTheme, systemTheme, watchSystemTheme } from "./theme";
import { ThemeContext } from "./themeContext";

function ThemeProvider({ children }) {
  const { user } = useAuth();
  // The token gives the name straight away; /me would arrive after the first paint
  const username = user?.username ?? tokenSubject();
  const [system, setSystem] = useState(systemTheme);
  const [choice, setChoice] = useState(() => ({ username, theme: storedTheme(username) }));

  useEffect(() => watchSystemTheme(setSystem), []);

  // Someone else signed in (or out): use their choice instead
  if (choice.username !== username) {
    setChoice({ username, theme: storedTheme(username) });
  }

  const theme = (choice.username === username ? choice.theme : storedTheme(username)) ?? system;

  // During render, not in an effect: children such as the Dashboard chart read
  // the colour tokens while rendering, and this renders before they do
  applyTheme(theme);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    storeTheme(username, next);
    setChoice({ username, theme: next });
  }, [theme, username]);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export default ThemeProvider;
