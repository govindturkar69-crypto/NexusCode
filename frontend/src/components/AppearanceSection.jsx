import { useState } from "react";
import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { setMotionPreference, storedMotion } from "../motion/motion";
import { useTheme } from "../theme/useTheme";
import Card from "./ui/Card";

// A row of radio buttons drawn as a segmented control
function Segmented({ legend, name, value, options, onChange, hint }) {
  return (
    <fieldset className="segmented-field">
      <legend className="field__label">{legend}</legend>
      <div className="segmented">
        {options.map((option) => (
          <label key={option.value} className={`segmented__option ${value === option.value ? "is-checked" : ""}`}>
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            {option.icon}
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hint && <p className="field__hint">{hint}</p>}
    </fieldset>
  );
}

// Theme and motion. Both apply at once and are remembered on this device.
function AppearanceSection() {
  const { theme, toggleTheme } = useTheme();
  const [motion, setMotion] = useState(() => storedMotion() ?? "system");

  function chooseMotion(value) {
    setMotion(value);
    setMotionPreference(value === "system" ? null : value);
  }

  return (
    <section className="stack">
      <h2 className="section-title section-title--icon"><Palette size={18} aria-hidden="true" /> Appearance</h2>
      <Card className="stack">
        <Segmented
          legend="Theme"
          name="theme"
          value={theme}
          onChange={(value) => value !== theme && toggleTheme()}
          options={[
            { value: "light", label: "Light", icon: <Sun size={14} aria-hidden="true" /> },
            { value: "dark", label: "Dark", icon: <Moon size={14} aria-hidden="true" /> },
          ]}
        />
        <Segmented
          legend="Motion"
          name="motion"
          value={motion}
          onChange={chooseMotion}
          hint="Reduced turns slides and zooms into simple fades. System follows your device's setting."
          options={[
            { value: "system", label: "System", icon: <Monitor size={14} aria-hidden="true" /> },
            { value: "reduce", label: "Reduced" },
            { value: "full", label: "Full" },
          ]}
        />
      </Card>
    </section>
  );
}

export default AppearanceSection;
