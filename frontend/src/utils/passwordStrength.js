// A rough, friendly strength hint for new passwords. The server's rule (8 to 72
// bytes) is what's enforced; this only nudges people towards longer, mixed ones.
export function passwordStrength(password) {
  const value = String(password ?? "");
  if (!value) return { score: 0, label: "", hint: "Use 8 or more characters." };
  const bytes = new TextEncoder().encode(value).length;
  if (bytes < 8) return { score: 1, label: "Too short", hint: `${8 - bytes} more character${8 - bytes === 1 ? "" : "s"} needed.` };
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  const points = (bytes >= 12 ? 1 : 0) + (bytes >= 16 ? 1 : 0) + (kinds >= 2 ? 1 : 0) + (kinds >= 3 ? 1 : 0);
  if (points >= 3) return { score: 4, label: "Strong", hint: "Great password." };
  if (points === 2) return { score: 3, label: "Good", hint: "Good. Longer is even better." };
  return { score: 2, label: "Fair", hint: "Add length or mix in numbers and symbols." };
}
