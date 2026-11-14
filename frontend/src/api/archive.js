import { ApiError, getToken } from "./client";

// ZIP export and import. Both need things apiFetch doesn't do: a binary
// download with progress, and an upload with progress (only XHR reports that).

const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // matches the server

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function filenameFrom(disposition, fallback) {
  const match = /filename="?([^";]+)"?/i.exec(disposition ?? "");
  return match ? match[1] : fallback;
}

async function errorFrom(res) {
  const data = await res.json().catch(() => null);
  return new ApiError(typeof data?.detail === "string" ? data.detail : `Request failed (${res.status})`, res.status, data);
}

// Downloads the project's ZIP and saves it. onProgress(fraction or null when unknown)
export async function downloadProjectZip(projectId, { onProgress = () => {}, save = saveBlob } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}/projects/${projectId}/export`, { headers: authHeaders() });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  if (!res.ok) throw await errorFrom(res);
  const total = Number(res.headers.get("content-length")) || 0;
  const name = filenameFrom(res.headers.get("content-disposition"), `project-${projectId}.zip`);
  let blob;
  if (res.body?.getReader && total) {
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(Math.min(1, received / total));
    }
    blob = new Blob(chunks, { type: "application/zip" });
  } else {
    onProgress(null);
    blob = await res.blob();
  }
  onProgress(1);
  save(blob, name);
  return { name, size: blob.size };
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Uploads a ZIP for a preview (dryRun) or the real import. onProgress(fraction of the upload)
export function uploadProjectZip(projectId, file, { dryRun = true, decisions = {}, onProgress = () => {}, Xhr = XMLHttpRequest } = {}) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("dry_run", dryRun ? "true" : "false");
    form.append("decisions", JSON.stringify(decisions));
    const xhr = new Xhr();
    xhr.open("POST", `${API_URL}/projects/${projectId}/code/import`);
    for (const [key, value] of Object.entries(authHeaders())) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new ApiError("Can't reach the server. Check your connection and try again.", 0));
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(typeof data?.detail === "string" ? data.detail : `Request failed (${xhr.status})`, xhr.status, data));
    };
    xhr.send(form);
  });
}
