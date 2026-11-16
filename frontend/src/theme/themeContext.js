import { createContext } from "react";

// { theme: "light" | "dark", toggleTheme(), accent, setAccent(name), contrast: "normal" | "high", setContrast(value) }
// provided by ThemeProvider
export const ThemeContext = createContext({
  theme: "dark",
  toggleTheme: () => {},
  accent: "blue",
  setAccent: () => {},
  contrast: "normal",
  setContrast: () => {},
});
