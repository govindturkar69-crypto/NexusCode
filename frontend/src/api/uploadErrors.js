/**
 * Friendly wording for the upload limits (review M3). The server enforces them:
 * 30 uploads a minute per person (429) and 200 uploaded files per project (409).
 * Returns { title, description } for a toast, or null for any other error.
 */
export function describeUploadError(err) {
  if (err?.status === 429) {
    return {
      title: "Too many uploads",
      description: "You can upload up to 30 files a minute. Wait a moment, then try again.",
    };
  }
  if (err?.status === 409) {
    return {
      title: "This project's file space is full",
      description: err.message || "Delete some files to upload more.",
    };
  }
  return null;
}
