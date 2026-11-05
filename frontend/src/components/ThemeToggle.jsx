import { useTheme } from "../theme/useTheme";
import Button from "./ui/Button";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button variant="ghost" size="icon" aria-label={`Switch to ${next} theme`} onClick={toggleTheme}>
      {theme === "dark" ? "☀️" : "🌙"}
    </Button>
  );
}

export default ThemeToggle;
