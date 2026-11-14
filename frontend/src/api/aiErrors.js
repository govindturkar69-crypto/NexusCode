// The backend answers every AI route with 503 {"detail": "AI is not configured"}
// when no Gemini key is set. These turn that into one clear message everywhere.
export const AI_NOT_CONFIGURED = "AI is not configured";

export const AI_NOT_CONFIGURED_TEXT =
  "AI is not configured on this server, so the AI features are turned off. An administrator needs to add a Gemini API key.";

export function isAINotConfigured(error) {
  return error?.status === 503 && error?.message === AI_NOT_CONFIGURED;
}

// What to show for a failed AI request
export function aiErrorText(error, fallback = "Something went wrong. Please try again.") {
  if (isAINotConfigured(error)) return AI_NOT_CONFIGURED_TEXT;
  return error?.message || fallback;
}
