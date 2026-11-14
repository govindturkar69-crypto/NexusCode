import { colorFor } from "../../collab/collabSession";
import { initials, textOn } from "./avatarColors";

// A person's initials in their colour (the same colour as their live-editing cursor).
// The name is the accessible label unless decorative (then it's hidden).
function Avatar({ name, color, size = "md", decorative = false, ring = false, className = "" }) {
  const background = color ?? colorFor(name);
  return (
    <span
      className={`avatar avatar--${size} ${ring ? "avatar--ring" : ""} ${className}`}
      style={{ background, color: textOn(background) }}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative ? "true" : undefined}
      title={decorative ? undefined : name}
    >
      {initials(name)}
    </span>
  );
}

// Several avatars overlapping, with "+N" past `max`. One label for the group.
export function AvatarStack({ names, max = 4, size = "sm", label }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span className="avatar-stack" role="img" aria-label={label ?? names.join(", ")}>
      {shown.map((name) => (
        <Avatar key={name} name={name} size={size} decorative className="avatar-stack__item" />
      ))}
      {extra > 0 && <span className={`avatar avatar--${size} avatar--more avatar-stack__item`} aria-hidden="true">+{extra}</span>}
    </span>
  );
}

export default Avatar;
