import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";

// Loads a project and what the current user may do in it. The server enforces
// all of this; these flags only decide which controls to show.
export function useProject(projectId) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    return apiFetch(`/projects/${projectId}`)
      .then((data) => {
        setProject(data.project);
        setError("");
      })
      .catch((err) => setError(err.message));
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const role = project?.role ?? null;
  return {
    project,
    role,
    canEdit: role === "editor" || role === "owner",
    isOwner: role === "owner",
    error,
    reload,
  };
}
