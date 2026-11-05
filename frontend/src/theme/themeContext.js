import { createContext } from "react";

// { theme: "light" | "dark", toggleTheme() } — provided by ThemeProvider
export const ThemeContext = createContext({ theme: "dark", toggleTheme: () => {} });
