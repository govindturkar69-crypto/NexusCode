import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { MonacoBinding } from "y-monaco";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { CollabFiles } from "../collab/collabFiles";
import { replaceText } from "../collab/collabSession";
import { describePeople } from "../collab/presence";
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
import { Bot, FilePlus, FolderPlus, Monitor, Play, Square, Users, X } from "lucide-react";
import FileIcon from "../components/FileIcon";
import GithubIcon from "../components/icons/GithubIcon";
import Alert from "../components/ui/Alert";
import { AvatarStack } from "../components/ui/Avatar";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
const LANGUAGE_NAMES = {
  python: "Python", javascript: "JavaScript", typescript: "TypeScript", html: "HTML", css: "CSS",
  json: "JSON", markdown: "Markdown", java: "Java", cpp: "C++", c: "C", go: "Go", rust: "Rust",
  sql: "SQL", shell: "Shell", yaml: "YAML", xml: "XML", plaintext: "Plain text",
};

// Self-hosted Monaco (no CDN); must run before <Editor> mounts
import "../editor/monacoSetup";
import { defineNexusThemes, monacoTheme } from "../editor/monacoThemes";
import { useTheme } from "../theme/useTheme";

// Picks up files that teammates added, renamed or deleted
const REFRESH_FILES_EVERY_MS = 30000;

const SAVE_STATUS = {
  saved: { text: "All changes saved", className: "muted" },
  unsaved: { text: "Unsaved changes", className: "muted" },
  saving: { text: "Saving...", className: "muted" },
  error: { text: "Save failed", className: "text-danger" },
};

// What the status line says about a file's live session, and whether typing waits for it
function liveStatus(state) {
  if (!state) return { text: null, readOnly: false };
  // Ended by the server: the file is edited and autosaved the ordinary way
  if (state.closed) return { text: null, readOnly: false, notice: `Live editing stopped: ${state.closed.message} Your changes are saved normally.` };
  if (!state.synced) return { text: "Connecting to live editing...", readOnly: true };
  const viewer = state.role === "viewer";
  if (state.status === "connected") return { text: viewer ? "View only (live)" : "Live: changes save as you type", readOnly: viewer };
  return { text: "Offline: your changes will sync when you're back", readOnly: viewer };
}

function CodeEditor() {
  const { projectId } = useParams();
  const { role, canEdit, isOwner } = useProject(projectId);
  const { user } = useAuth();
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
  // Live editing sessions, one per open tab
  const [collab] = useState(() => new CollabFiles());
  useSyncExternalStore(collab.subscribe, collab.getVersion);
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
        .then((data) => {
          // The live document may already have arrived, and it's newer than the saved copy
          if (collab.isLive(id)) return;
          setContents((prev) => ({ ...prev, [id]: data.code_file.content ?? "" }));
        })
        .catch((err) => {
          requested.current.delete(id);
          setError(err.message);
        });
    },
    [flush, collab]
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

  // ---- live editing: one Yjs session per open tab (see src/collab) ----

  const [editorInstance, setEditorInstance] = useState(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });

  // Cursor position for the status bar
  useEffect(() => {
    if (!editorInstance?.onDidChangeCursorPosition) return undefined;
    const sub = editorInstance.onDidChangeCursorPosition((e) => setCursor({ line: e.position.lineNumber, column: e.position.column }));
    return () => sub.dispose();
  }, [editorInstance]);

  // Anyone's change to an open file updates the editor's copy, which Run, Preview,
  // the AI and the agent read
  const onCollabText = useCallback((fileId, text) => {
    if (contentsRef.current[fileId] === text) return;
    contentsRef.current = { ...contentsRef.current, [fileId]: text };
    setContents((prev) => (prev[fileId] === text ? prev : { ...prev, [fileId]: text }));
  }, []);

  useEffect(() => {
    collab.configure({ projectId, username: user?.username, onText: onCollabText });
    collab.setOpen(openIds);
  }, [collab, projectId, user?.username, onCollabText, openIds]);

  useEffect(() => () => collab.destroyAll(), [collab]);

  // Edits made offline live only in this tab until the server is back
  useEffect(() => {
    function onBeforeUnload(event) {
      if (!collab.hasUnsynced()) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [collab]);

  const activeLive = activeId !== null && collab.isLive(activeId);

  // The editor shows the live document once it has synced: y-monaco keeps the
  // Monaco model and the Yjs text the same, both ways, and draws other people's cursors
  useEffect(() => {
    if (!editorInstance || !activeLive) return undefined;
    const session = collab.get(activeId);
    const model = editorInstance.getModel();
    if (!session || !model) return undefined;
    const binding = new MonacoBinding(session.text, model, new Set([editorInstance]), session.awareness);
    return () => binding.destroy();
  }, [collab, editorInstance, activeId, activeLive]);

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
      if (existing && collab.isLive(existing.id)) {
        // Open and live: the change goes into the shared document, so everyone sees it
        replaceText(collab.get(existing.id).text, content);
        return { fileId: existing.id, created: false };
      }
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
    [projectId, forget, collab]
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
    if (collab.isLive(activeId)) {
      // Yjs carries and saves the change; autosave stays out of it
      contentsRef.current = { ...contentsRef.current, [activeId]: text };
      setContents((prev) => ({ ...prev, [activeId]: text }));
      return;
    }
    setContents((prev) => ({ ...prev, [activeId]: text }));
    autosave.schedule(activeId, text);
  }

  // Replaces the open file's text (AI "Apply"): through the live document when there is one
  function applyToActive(text) {
    if (activeId !== null && collab.isLive(activeId)) replaceText(collab.get(activeId).text, text);
    else handleCodeChange(text);
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
  const activeLiveState = liveStatus(activeId === null ? null : collab.stateFor(activeId));
  const activePeople = activeId === null ? [] : collab.people(activeId);
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
      <PageHeader
        title="Code editor"
        actions={
          <>
            <span role="status" aria-live="polite" className={`small editor-save ${saveStatus.className}`}>
              {role === "viewer" ? "View only" : activeLiveState.text ?? saveStatus.text}
              {activeSave.status === "error" && (
                <>
                  {`: ${activeSave.error} `}
                  <Button variant="link" onClick={() => flush(activeId)}>Retry</Button>
                </>
              )}
            </span>
            {canEdit && (
              <Button variant={showAgent ? "primary" : "secondary"} aria-pressed={showAgent} onClick={toggleAgent} disabled={loadState !== "ready"} icon={<Bot size={16} aria-hidden="true" />}>
                Agent
              </Button>
            )}
            {isOwner && (
              <Button onClick={() => { setPushed(null); setShowPush(true); }} disabled={loadState !== "ready" || files.length === 0} icon={<GithubIcon size={15} />}>
                Push to GitHub
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
            <div className="editor-tree__actions">
              <span className="editor-tree__title">Files</span>
              <Button size="sm" variant="secondary" aria-label="+ File" title="New file" icon={<FilePlus size={13} aria-hidden="true" />} onClick={() => setDialog({ kind: "new-file", folder: "" })} disabled={loadState !== "ready"}>File</Button>
              <Button size="sm" variant="secondary" aria-label="+ Folder" title="New folder" icon={<FolderPlus size={13} aria-hidden="true" />} onClick={() => setDialog({ kind: "new-folder" })} disabled={loadState !== "ready"}>Folder</Button>
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
          {/* Open files: a group of buttons (the open one marked with aria-current), each
              with its own Close button, which a role="tablist" could not contain */}
          <div role="group" aria-label="Open files" className="editor-tabs">
            {openIds.map((id) => {
              const file = filesById.get(id);
              if (!file) return null;
              const fileStatus = autosave.state(id).status;
              const others = collab.people(id);
              return (
                <span key={id} className={`editor-tab ${id === activeId ? "editor-tab--active" : ""}`}>
                  <button type="button" aria-current={id === activeId ? "true" : undefined} title={file.path} className="editor-tab__name" onClick={() => setActiveId(id)}>
                    <FileIcon name={file.path} size={13} />
                    {baseName(file.path)}
                    {others.length > 0 && (
                      <span className="editor-tab__people" title={describePeople(others)} aria-label={`${others.length} other ${others.length === 1 ? "person" : "people"} here`}>
                        <Users size={11} aria-hidden="true" />{others.length}
                      </span>
                    )}
                    {fileStatus !== "saved" && (
                      <span className={`editor-tab__dot ${fileStatus === "error" ? "text-danger" : ""}`} aria-label={SAVE_STATUS[fileStatus].text}> ●</span>
                    )}
                  </button>
                  <button type="button" className="editor-tab__close" aria-label={`Close ${baseName(file.path)}`} onClick={() => closeTab(id)}><X size={13} aria-hidden="true" /></button>
                </span>
              );
            })}
          </div>
          {activeLoaded && activeLiveState.notice && <p className="hint" role="note" style={{ padding: "0 1rem" }}>{activeLiveState.notice}</p>}
          {activeLive && activePeople.length > 0 && (
            <div className="presence-bar" aria-label="People in this file">
              {activePeople.map((person) => (
                <span key={person.name} className="presence-bar__person" title={person.role === "viewer" ? `${person.name} is viewing` : `${person.name} is editing`}>
                  <span className="presence-bar__dot" style={{ background: person.color }} aria-hidden="true" />
                  {person.name}
                  {person.role === "viewer" && <span className="muted"> (viewing)</span>}
                </span>
              ))}
              <span className="muted small">{activePeople.filter((p) => p.role === "editor").length > 0 ? `${activePeople.length + 1} people editing` : ""}</span>
            </div>
          )}
          {activeLive && <style>{collab.cursorStyles(activeId)}</style>}
          {activeLoaded && (
            <div className="run-bar">
              {runningHere ? (
                <Button size="sm" variant="danger" onClick={runner.stop} icon={<Square size={11} aria-hidden="true" />}>Stop</Button>
              ) : (
                <Button size="sm" onClick={runActive} disabled={!activeRunner} title="Ctrl+Enter" icon={<Play size={12} aria-hidden="true" />}>Run</Button>
              )}
              {hasHtml && (
                <Button size="sm" variant="secondary" aria-pressed={showPreview} onClick={() => setShowPreview(!showPreview)} icon={<Monitor size={13} aria-hidden="true" />}>
                  Preview
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
              // Live files: y-monaco owns the text, so React mustn't set it
              {...(activeLive ? { defaultValue: contents[activeId] } : { value: contents[activeId] })}
              onChange={handleCodeChange}
              onMount={(editor) => setEditorInstance(editor)}
              beforeMount={defineNexusThemes}
              theme={monacoTheme(theme)}
              // Room above the first line for other people's name labels
              options={{ fontSize: 14, minimap: { enabled: false }, padding: { top: 18 }, readOnly: !canEdit || activeLiveState.readOnly }}
            />
          ) : (
            <p role="status" className="muted editor-placeholder">
              {activeFile ? "Loading code..." : "Open a file from the list to start."}
            </p>
          )}
          {activeLoaded && (
            <div className="editor-status" aria-label="Editor status">
              <span className="editor-status__item">
                <FileIcon name={activeFile.path} size={12} />
                {LANGUAGE_NAMES[activeFile.language] ?? activeFile.language ?? "Plain text"}
              </span>
              <span className="editor-status__item mono">Ln {cursor.line}, Col {cursor.column}</span>
              {(!canEdit || activeLiveState.readOnly) && <span className="editor-status__item">Read-only</span>}
              <span className="grow" />
              {activeLive && activePeople.length > 0 && (
                <span className="editor-status__item">
                  <AvatarStack names={activePeople.map((p) => p.name)} max={4} size="xs" label={`${activePeople.length} other ${activePeople.length === 1 ? "person" : "people"} in this file`} />
                </span>
              )}
              <span className="editor-status__item">{activeLive ? "Live" : "Local"}</span>
            </div>
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
            onApply={applyToActive}
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
