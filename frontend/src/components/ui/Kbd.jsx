import { keyLabel } from "../../shortcuts/shortcuts";

// A key combination drawn as keycaps: <Kbd keys={["Mod", "K"]} />. "then" between
// keys is shown as a word, for sequences like G then P.
function Kbd({ keys, className = "" }) {
  return (
    <span className={`kbd-group ${className}`}>
      {keys.map((key, i) =>
        key === "then" ? (
          <span key={i} className="kbd-then">then</span>
        ) : (
          <kbd key={i} className="kbd">{keyLabel(key)}</kbd>
        ),
      )}
    </span>
  );
}

export default Kbd;
