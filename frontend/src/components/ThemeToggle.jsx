import { Moon, Sun } from "lucide-react";
import { useTheme } from "../theme/useTheme";
import Button from "./ui/Button";
import Tooltip from "./ui/Tooltip";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Tooltip label={`${next === "light" ? "Light" : "Dark"} theme`} side="bottom">
      <Button variant="subtle" size="icon" aria-label={`Switch to ${next} theme`} onClick={toggleTheme} className="theme-toggle">
        {/* The icon swaps with a quick turn (a fade with reduced motion) */}
        <span key={theme} className="theme-toggle__icon" aria-hidden="true">
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </span>
      </Button>
    </Tooltip>
  );
}

export default ThemeToggle;
