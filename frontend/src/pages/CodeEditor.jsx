import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { apiFetch } from "../api/client";
import { baseName, buildTree, isInFolder, renameFolderPath } from "../editor/fileTree";
import { isHtmlFile } from "../editor/preview";
import { collectPythonFiles } from "../runners/pythonProject";
import { runnerFor, UNSUPPORTED_MESSAGE } from "../runners/runnerFor";
import { useCodeRunner } from "../runners/useCodeRunner";
import { useAutosave } from "../editor/useAutosave";
import { useProject } from "../projects/useProject";
import AgentPanel from "../components/AgentPanel";
import AIPanel from "../components/AIPanel";
import FileTree from "../components/FileTree";
import PathDialog from "../components/PathDialog";
import PreviewPanel from "../components/PreviewPanel";
import PushToGithubDialog from "../components/PushToGithubDialog";
import RunPanel from "../components/RunPanel";
import Alert from "../components/ui/Alert";
import BackLink from "../components/ui/BackLink";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
// Self-hosted Monaco (no CDN); must run before <Editor> mounts
import "../editor/monacoSetup";
import { useTheme } from "../theme/useTheme";

// Picks up files that teammates added, renamed or deleted
const REFRESH_FILES_EVERY_MS = 30000;

const SAVE_STATUS = {
  saved: { text: "All changes saved", className: "muted" },
  unsaved: { text: "Unsaved changes", className: "muted" },
  saving: { text: "Saving...", className: "muted" },
  error: { text: "Save failed", className: "text-danger" },
};

function CodeEditor() {
  const { projectId } = useParams();
  const { role, canEdit, isOwner } = useProject(projectId);
  const { theme } = useTheme();
  const [files, setFiles] = useState([]);
  const [loadState, setLoadState] = useState("loading"); // loading | ready | error
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [emptyFolders, setEmptyFolders] = useState([]);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [openIds, setOpenIds] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [contents, setContents] = useState({}); // file id -> text, once loaded
  const [dialog, setDialog] = useState(null); // { kind, ... } for PathDialog
  const [toDelete, setToDelete] = useState(null); // { kind: "file" | "folder", ... }
  const [deleting, setDeleting] = useState(false);
  const [showPush, setShowPush] = useState(false);
  const [pushed, setPushed] = useState(null);
  const [showAgent, setShowAgent] = useState(false);

  const [showPreview, setShowPreview] = useState(false);
  const [previewRuns, setPreviewRuns] = useState(0);
  const [stdin, setStdin] = useState("");
  const previewPanel = useRef(null);
  const agentPanel = useRef(null);
  const runner = useCodeRunner();
  const [saveCount, setSaveCount] = useState(0);

  const save = useCallback(
    (id, content, { signal, keepalive } = {}) =>
      apiFetch(`/code-files/${id}`, { method: "PUT", body: { content }, signal, keepalive }).then((result) => {
        setSaveCount((count) => count + 1);
        return result;
      }),
    []
  );
  const autosave = useAutosave(save, { delay: 1000 });
  const { flush, forget } = autosave;

  // Files whose content is loaded or on its way, so each is fetched once
  const requested = useRef(new Set());

  const loadContent = useCallback(
    (id) => {
      if (requested.current.has(id)) return;
      requested.current.add(id);
      // Anything still being saved has to land first, or this reads old text
      flush(id)
        .then(() => apiFetch(`/code-files/${id}`))
        .then((data) => setContents((prev) => ({ ...prev, [id]: data.code_file.content ?? "" })))
        .catch((err) => {
          requested.current.delete(id);
          setError(err.message);
        });
    },
    [flush]
  );

  const openFile = useCallback(
    (file) => {
      setOpenIds((prev) => (prev.includes(file.id) ? prev : [...prev, file.id]));
      setActiveId(file.id);
      loadContent(file.id);
    },
    [loadContent]
  );

  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const openIdsRef = useRef(openIds);
  useEffect(() => {
    openIdsRef.current = openIds;
  }, [openIds]);

  // For the preview: what's in the editor if the file is open, else the saved copy.
  // updated_at in the key means a teammate's newer version is fetched, not the cached one.
  const contentsRef = useRef(contents);
  useEffect(() => {
    contentsRef.current = contents;
  }, [contents]);
  const savedCopies = useRef(new Map());

  const readFileForPreview = useCallback(async (file) => {
    if (contentsRef.current[file.id] !== undefined) return contentsRef.current[file.id];
    const key = `${file.id}:${file.updated_at}`;
    if (!savedCopies.current.has(key)) {
      const data = await apiFetch(`/code-files/${file.id}`);
      savedCopies.current.set(key, data.code_file.content ?? "");
    }
    return savedCopies.current.get(key);
  }, []);

  // ---- for the agent: it reads the project as the editor shows it, and saves only what the user accepts ----

  const readForAgent = useCallback(
    (path) => {
      const file = filesRef.current.find((f) => f.path === path);
      return file ? readFileForPreview(file) : Promise.resolve(null);
    },
    [readFileForPreview]
  );

  const sortByPath = (list) => [...list].sort((a, b) => a.path.localeCompare(b.path));

  const applyForAgent = useCallback(
    async (path, content) => {
      const existing = filesRef.current.find((f) => f.path === path);
      if (existing) {
        // The user saw and accepted this version, so a pending autosave mustn't overwrite it
        forget(existing.id);
        const data = await apiFetch(`/code-files/${existing.id}`, { method: "PUT", body: { content } });
        const updated = { ...existing, ...data.code_file };
        filesRef.current = filesRef.current.map((f) => (f.id === existing.id ? updated : f));
        setFiles(filesRef.current);
        if (contentsRef.current[existing.id] !== undefined) {
          contentsRef.current = { ...contentsRef.current, [existing.id]: content };
          setContents((prev) => ({ ...prev, [existing.id]: content }));
        }
        setSaveCount((count) => count + 1);
        return { fileId: existing.id, created: false };
      }
      const data = await apiFetch(`/projects/${projectId}/code/files`, { method: "POST", body: { path, content } });
      filesRef.current = sortByPath([...filesRef.current, data.code_file]);
      setFiles(filesRef.current);
      setEmptyFolders((prev) => prev.filter((folder) => !isInFolder(path, folder)));
      return { fileId: data.code_file.id, created: true };
    },
    [projectId, forget]
  );

  const closeTabs = useCallback((ids) => {
    const closing = new Set(ids);
    ids.forEach((id) => requested.current.delete(id));
    setOpenIds((prev) => prev.filter((id) => !closing.has(id)));
    setActiveId((active) => {
      if (!closing.has(active)) return active;
      const remaining = openIdsRef.current.filter((id) => !closing.has(id));
      return remaining.length > 0 ? remaining[remaining.length - 1] : null;
    });
    // Reopening fetches again, so a tab never shows a teammate's old version
    setContents((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !closing.has(Number(id)))));
  }, []);

  const fetchFiles = useCallback(
    () => apiFetch(`/projects/${projectId}/code/files`).then((data) => data.code_files ?? []),
    [projectId]
  );

  // First load: open the first file, so there's something to look at
  useEffect(() => {
    let cancelled = false;
    fetchFiles()
      .then((list) => {
        if (cancelled) return;
        setFiles(list);
        setLoadState("ready");
        if (list.length > 0) openFile(list[0]);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [fetchFiles, openFile]);

  const refreshFiles = useCallback(
    () =>
      fetchFiles().then((list) => {
        setFiles(list);
        const present = new Set(list.map((file) => file.id));
        const gone = openIdsRef.current.filter((id) => !present.has(id));
        if (gone.length > 0) {
          gone.forEach(forget);
          closeTabs(gone);
          setNotice("A file you had open was deleted or moved by someone else, so its tab was closed.");
        }
      }),
    [fetchFiles, forget, closeTabs]
  );

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) refreshFiles().catch(() => {});
    }, REFRESH_FILES_EVERY_MS);
    return () => clearInterval(timer);
  }, [refreshFiles]);

  function handleCodeChange(value) {
    const text = value ?? "";
    if (activeId === null || !canEdit || text === contents[activeId]) return;
    setContents((prev) => ({ ...prev, [activeId]: text }));
    autosave.schedule(activeId, text);
  }

  // Rejects if something couldn't be saved, so a push never leaves changes behind
  async function saveEverything() {
    await Promise.all(openIds.map((id) => flush(id)));
    const failed = openIds.map((id) => autosave.pendingError(id)).find(Boolean);
    if (failed) throw new Error(`Couldn't save your changes first: ${failed}`);
  }

  function closeTab(id) {
    flush(id);
    closeTabs([id]);
  }

  function toggleFolder(path) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function createFile(path) {
    return apiFetch(`/projects/${projectId}/code/files`, { method: "POST", body: { path } }).then((data) => {
      setFiles((prev) => [...prev, data.code_file].sort((a, b) => a.path.localeCompare(b.path)));
      setEmptyFolders((prev) => prev.filter((folder) => !isInFolder(path, folder)));
      requested.current.add(data.code_file.id);
      setContents((prev) => ({ ...prev, [data.code_file.id]: data.code_file.content ?? "" }));
      setOpenIds((prev) => [...prev, data.code_file.id]);
      setActiveId(data.code_file.id);
      setDialog(null);
    });
  }

  function renameFile(file, path) {
    return apiFetch(`/code-files/${file.id}`, { method: "PATCH", body: { path } }).then((data) => {
      setFiles((prev) => prev.map((f) => (f.id === file.id ? data.code_file : f)).sort((a, b) => a.path.localeCompare(b.path)));
      setDialog(null);
    });
  }

  function createFolder(path) {
    const clash = files.some((file) => file.path === path || isInFolder(file.path, path)) || emptyFolders.includes(path);
    if (clash) return Promise.reject(new Error(`${path} already exists.`));
    setEmptyFolders((prev) => [...prev, path]);
    setDialog(null);
    return Promise.resolve();
  }

  function renameFolder(node, path) {
    const moveEmpty = () => setEmptyFolders((prev) => prev.map((folder) => renameFolderPath(folder, node.path, path)));
    if (!node.hasFiles) {
      moveEmpty();
      setDialog(null);
      return Promise.resolve();
    }
    return apiFetch(`/projects/${projectId}/code/folders/rename`, { method: "POST", body: { path: node.path, new_path: path } }).then(async () => {
      moveEmpty();
      await refreshFiles();
      setDialog(null);
    });
  }

  function removeLocally(ids) {
    const gone = new Set(ids);
    ids.forEach(forget);
    closeTabs(ids);
    setFiles((prev) => prev.filter((file) => !gone.has(file.id)));
  }

  function toggleAgent() {
    const opening = !showAgent;
    setShowAgent(opening);
    // It opens below the editor, so bring it into view
    if (opening) requestAnimationFrame(() => agentPanel.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  }

  function deleteForAgent(fileId) {
    return apiFetch(`/code-files/${fileId}`, { method: "DELETE" }).then(() => {
      filesRef.current = filesRef.current.filter((file) => file.id !== fileId);
      removeLocally([fileId]);
    });
  }

  function createTaskForAgent(task) {
    return apiFetch(`/projects/${projectId}/tasks`, { method: "POST", body: task });
  }

  function confirmDelete() {
    setDeleting(true);
    setError("");
    let request;
    if (toDelete.kind === "file") {
      request = apiFetch(`/code-files/${toDelete.file.id}`, { method: "DELETE" }).then(() => removeLocally([toDelete.file.id]));
    } else {
      const { path, hasFiles } = toDelete.node;
      const dropEmpty = () => setEmptyFolders((prev) => prev.filter((folder) => folder !== path && !isInFolder(folder, path)));
      request = hasFiles
        ? apiFetch(`/projects/${projectId}/code/folders/delete`, { method: "POST", body: { path } }).then((data) => {
            removeLocally(data.deleted);
            dropEmpty();
          })
        : Promise.resolve(dropEmpty());
    }
    request
      .catch((err) => setError(err.message))
      .finally(() => {
        setDeleting(false);
        setToDelete(null);
      });
  }

  const hasHtml = files.some((file) => isHtmlFile(file.path));
  const previewVersion = `${saveCount}|${files.map((file) => `${file.id}:${file.path}:${file.updated_at}`).join(",")}`;
  const nodes = useMemo(() => buildTree(files, emptyFolders), [files, emptyFolders]);
  const filesById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const activeFile = filesById.get(activeId) ?? null;
  const activeLoaded = activeFile !== null && contents[activeId] !== undefined;
  const activeSave = activeId === null ? { status: "saved", error: "" } : autosave.state(activeId);
  const saveStatus = SAVE_STATUS[activeSave.status];
  const activeRunner = activeFile ? runnerFor(activeFile.path, { hasHtml }) : null;
  const runningHere = activeId !== null && runner.runningFileId === activeId;

  // Runs what's in the editor, unsaved changes included. Nothing leaves the browser,
  // so viewers can run code too; only saving needs the editor role.
  function runActive() {
    if (!activeLoaded || !activeRunner) return;
    if (activeRunner === "preview") {
      setShowPreview(true);
      setPreviewRuns((count) => count + 1);
      requestAnimationFrame(() => previewPanel.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }));
    } else if (activeRunner === "python") {
      // Other .py files come along, so imports between project files work
      const file = activeFile;
      const code = contents[activeId];
      collectPythonFiles(files.map((f) => f.path), (path) => readForAgent(path), file.path, code)
        .catch(() => [])
        .then((projectFiles) => runner.run(file, code, "python", stdin, projectFiles.length ? { files: projectFiles, path: file.path } : {}));
    } else {
      runner.run(activeFile, contents[activeId], activeRunner, stdin);
    }
  }

  // Capture phase, so Monaco doesn't turn Ctrl+Enter into "insert line below" first
  const runShortcut = useRef(runActive);
  useEffect(() => {
    runShortcut.current = runActive;
  });
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
      // A dialog has its own meaning for Enter
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      event.stopPropagation();
      runShortcut.current();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <Page width={1400}>
      <BackLink to={`/projects/${projectId}`}>Back to board</BackLink>
      <PageHeader
        eyebrow="code --edit"
        title="Code Editor"
        actions={
          <>
            <span role="status" aria-live="polite" className={`small ${saveStatus.className}`}>
              {role === "viewer" ? "View only" : saveStatus.text}
              {activeSave.status === "error" && (
                <>
                  {`: ${activeSave.error} `}
                  <Button variant="link" onClick={() => flush(activeId)}>Retry</Button>
                </>
              )}
            </span>
            {canEdit && (
              <Button variant={showAgent ? "primary" : "ghost"} aria-pressed={showAgent} onClick={toggleAgent} disabled={loadState !== "ready"}>
                🤖 Agent
              </Button>
            )}
            {isOwner && (
              <Button onClick={() => { setPushed(null); setShowPush(true); }} disabled={loadState !== "ready" || files.length === 0}>
                🐙 Push to GitHub
              </Button>
            )}
          </>
        }
      />

      <Alert onDismiss={() => setError("")}>{error}</Alert>
      {notice && <Alert tone="info" onDismiss={() => setNotice("")}>{notice}</Alert>}
      {pushed && (
        <Alert tone="success" onDismiss={() => setPushed(null)}>
          {pushed.changed
            ? `Pushed ${pushed.files} file${pushed.files === 1 ? "" : "s"} to ${pushed.repo_full_name} (${pushed.branch}). `
            : `${pushed.repo_full_name} (${pushed.branch}) already has these files, so nothing new was committed. `}
          <a href={pushed.changed ? pushed.commit_url : pushed.repo_url} target="_blank" rel="noreferrer" className="btn btn--link">
            {pushed.changed ? "Open the commit" : "Open the repository"}
          </a>
        </Alert>
      )}

      <div className="editor-grid">
        <Card className="editor-grid__tree">
          {canEdit && (
            <div className="row" style={{ "--gap": "0.5rem", marginBottom: "0.75rem" }}>
              <Button size="sm" onClick={() => setDialog({ kind: "new-file", folder: "" })} disabled={loadState !== "ready"}>+ File</Button>
              <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "new-folder" })} disabled={loadState !== "ready"}>+ Folder</Button>
            </div>
          )}
          {loadState === "loading" && <p role="status" className="muted small">Loading files...</p>}
          {loadState === "ready" && nodes.length === 0 && (
            <p className="muted small">{canEdit ? "No files yet. Create the first one." : "No files yet."}</p>
          )}
          <FileTree
            nodes={nodes}
            canEdit={canEdit}
            activeId={activeId}
            collapsed={collapsed}
            onOpen={openFile}
            onToggleFolder={toggleFolder}
            onNewFile={(folder) => setDialog({ kind: "new-file", folder })}
            onRenameFile={(file) => setDialog({ kind: "rename-file", file })}
            onDeleteFile={(file) => setToDelete({ kind: "file", file })}
            onRenameFolder={(node) => setDialog({ kind: "rename-folder", node })}
            onDeleteFolder={(node) => setToDelete({ kind: "folder", node })}
          />
        </Card>

        <div className="card editor-grid__main">
          <div role="tablist" aria-label="Open files" className="editor-tabs">
            {openIds.map((id) => {
              const file = filesById.get(id);
              if (!file) return null;
              const fileStatus = autosave.state(id).status;
              return (
                <span key={id} className={`editor-tab ${id === activeId ? "editor-tab--active" : ""}`}>
                  <button type="button" role="tab" aria-selected={id === activeId} title={file.path} className="editor-tab__name" onClick={() => setActiveId(id)}>
                    {baseName(file.path)}
                    {fileStatus !== "saved" && (
                      <span className={`editor-tab__dot ${fileStatus === "error" ? "text-danger" : ""}`} aria-label={SAVE_STATUS[fileStatus].text}> ●</span>
                    )}
                  </button>
                  <button type="button" className="editor-tab__close" aria-label={`Close ${baseName(file.path)}`} onClick={() => closeTab(id)}>✕</button>
                </span>
              );
            })}
          </div>
          {activeLoaded && (
            <div className="run-bar">
              {runningHere ? (
                <Button size="sm" variant="danger" onClick={runner.stop}>■ Stop</Button>
              ) : (
                <Button size="sm" onClick={runActive} disabled={!activeRunner} title="Ctrl+Enter">▶ Run</Button>
              )}
              {hasHtml && (
                <Button size="sm" variant="ghost" aria-pressed={showPreview} onClick={() => setShowPreview(!showPreview)}>
                  🖥 Preview
                </Button>
              )}
              {activeRunner === "python" && (
                <details className="run-bar__stdin small">
                  <summary>Input (stdin){stdin ? ": set" : ""}</summary>
                  <label htmlFor="run-stdin" className="visually-hidden">Input (stdin)</label>
                  <textarea
                    id="run-stdin"
                    className="input mono small"
                    rows={3}
                    value={stdin}
                    onChange={(e) => setStdin(e.target.value)}
                    placeholder="One line for each input() call"
                  />
                </details>
              )}
              {activeRunner
                ? <span className="hint run-bar__hint">Runs in your browser. Ctrl+Enter</span>
                : <span className="hint run-bar__hint">{UNSUPPORTED_MESSAGE}</span>}
            </div>
          )}
          {activeLoaded ? (
            <Editor
              height="600px"
              path={`project-${projectId}/file-${activeId}`}
              language={activeFile.language ?? "plaintext"}
              value={contents[activeId]}
              onChange={handleCodeChange}
              theme={theme === "dark" ? "vs-dark" : "light"}
              options={{ fontSize: 14, minimap: { enabled: false }, readOnly: !canEdit }}
            />
          ) : (
            <p role="status" className="muted" style={{ padding: "1rem" }}>
              {activeFile ? "Loading code..." : "Open a file from the list to start."}
            </p>
          )}
          {activeId !== null && (
            <RunPanel
              result={runner.resultFor(activeId)}
              running={runningHere}
              loading={runner.loading}
              onClear={() => runner.clear(activeId)}
            />
          )}
          {showPreview && hasHtml && (
            <div ref={previewPanel}>
              {/* Keyed so that pressing Run starts the page afresh */}
              <PreviewPanel
                key={previewRuns}
                files={files}
                readFile={readFileForPreview}
                refreshKey={previewVersion}
                preferredEntry={activeFile && isHtmlFile(activeFile.path) ? activeFile.path : null}
                onClose={() => setShowPreview(false)}
              />
            </div>
          )}
        </div>

        <div className="editor-grid__ai">
          <AIPanel
            projectId={projectId}
            files={files}
            activeFile={activeLoaded ? activeFile : null}
            activeContent={contents[activeId]}
            canEdit={canEdit}
            beforeAsk={saveEverything}
            onApply={handleCodeChange}
          />
        </div>
      </div>

      {showAgent && canEdit && (
        <div ref={agentPanel}>
        <AgentPanel
          projectId={projectId}
          files={files}
          readLive={readForAgent}
          applyFile={applyForAgent}
          deleteFile={deleteForAgent}
          createTask={createTaskForAgent}
          onClose={() => setShowAgent(false)}
        />
        </div>
      )}

      {dialog?.kind === "new-file" && (
        <PathDialog
          title="New file"
          label="File path"
          initial={dialog.folder ? `${dialog.folder}/` : ""}
          hint="Slashes make folders, for example src/app.py. The extension sets the language."
          submitLabel="Create"
          onSubmit={createFile}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "new-folder" && (
        <PathDialog
          title="New folder"
          label="Folder path"
          hint="An empty folder stays in this browser until you add a file to it."
          submitLabel="Create"
          onSubmit={createFolder}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename-file" && (
        <PathDialog
          title="Rename file"
          label="File path"
          initial={dialog.file.path}
          hint="Change the folders in the path to move the file."
          submitLabel="Rename"
          onSubmit={(path) => renameFile(dialog.file, path)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename-folder" && (
        <PathDialog
          title="Rename folder"
          label="Folder path"
          initial={dialog.node.path}
          submitLabel="Rename"
          onSubmit={(path) => renameFolder(dialog.node, path)}
          onClose={() => setDialog(null)}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title={toDelete.kind === "file" ? "Delete this file?" : "Delete this folder?"}
          message={
            toDelete.kind === "file"
              ? `"${toDelete.file.path}" will be permanently deleted.`
              : `"${toDelete.node.path}" and everything in it will be permanently deleted.`
          }
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}

      {showPush && (
        <PushToGithubDialog
          projectId={projectId}
          fileCount={files.length}
          beforePush={saveEverything}
          onClose={() => setShowPush(false)}
          onPushed={(result) => {
            setShowPush(false);
            setPushed(result);
          }}
        />
      )}
    </Page>
  );
}

export default CodeEditor;
