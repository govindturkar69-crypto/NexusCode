// Chat display helpers with no React in them.

export function formatMessageTime(iso, now = new Date()) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  const day = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day}, ${time}`;
}

export function typingText(names) {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
  return "Several people are typing...";
}
