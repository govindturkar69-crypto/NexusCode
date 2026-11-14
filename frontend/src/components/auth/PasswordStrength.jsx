import { passwordStrength } from "../../utils/passwordStrength";

// A four-step meter and a short hint under a new-password field. Always takes
// the same space, so typing never moves the form.
function PasswordStrength({ value }) {
  const { score, label, hint } = passwordStrength(value);
  return (
    <div className={`strength strength--${score}`}>
      <div className="strength__bar" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => <span key={i} className={i <= score ? "is-on" : ""} />)}
      </div>
      <p className="strength__text" aria-live="polite">
        {label && <strong>{label}. </strong>}
        {hint}
      </p>
    </div>
  );
}

export default PasswordStrength;
