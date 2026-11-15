import { useCallback, useEffect, useId, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Bot, FileArchive, History, RotateCcw, Save, Tag } from "lucide-react";
import { apiFetch } from "../api/client";
import { defineNexusThemes, monacoTheme } from "../editor/monacoThemes";
import { useTheme } from "../theme/useTheme";
import { relativeTime } from "../utils/time";
import Avatar from "./ui/Avatar";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import ConfirmDialog from "./ui/ConfirmDialog";
import Modal from "./ui/Modal";
import Skeleton, { LoadingRegion } from "./ui/Skeleton";
import { EmptyState, ErrorState } from "./ui/States";
import { useToast } from "./ui/toastContext";
import "../styles/history.css";

const SOURCES = {
  save: { label: "Saved", Icon: Save },
  autosnapshot: { label: "Live edit", Icon: Bot },
  restore: { label: "Restored", Icon: RotateCcw },
  import: { label: "Imported", Icon: FileArchive },
};

// Screen readers announce each side of the diff by name. Monaco's EditContext
// input ignores the diff-level aria options, so each inner editor is named here.
function nameDiffEditors(diffEditor) {
  diffEditor.getOriginalEditor().updateOptions({ ariaLabel: "This version (read only)" });
  diffEditor.getModifiedEditor().updateOptions({ ariaLabel: "The current text (read only)" });
}

const absolute = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * A file's version history: a timeline of server-side snapshots, a diff of the
 * chosen one against the current text, and (owners and editors) restore.
 *   file            { id, path, language }
 *   currentContent  what the editor has now (live files update it as people type)
 *   canRestore      owner or editor
 *   beforeRestore() lands the editor's pending save first, so it can't overwrite the restore
 *   onRestored(content)
 */
function HistoryPanel({ file, currentContent, canRestore, beforeRestore, onRestored, onClose }) {
  const { theme } = useTheme();
  const toast = useToast();
  const listId = useId();
  const [versions, setVersions] = useState(null);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(null); // version id
  const [content, setContent] = useState({}); // version id -> text
  const [contentError, setContentError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(max-width: 760px)").matches);

  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 760px)");
    if (!query) return undefined;
    const onChange = (e) => setNarrow(e.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  const load = useCallback(() => {
    let cancelled = false;
    apiFetch(`/code-files/${file.id}/versions?limit=50`)
      .then((data) => {
        if (cancelled) return;
        setVersions(data.versions);
        setTotal(data.total);
        setLoadError("");
        setSelected((current) => current ?? data.versions[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  useEffect(() => load(), [load, attempt]);

  // The chosen version's text, fetched once
  useEffect(() => {
    if (selected == null || content[selected] !== undefined) return undefined;
    let cancelled = false;
    apiFetch(`/code-files/${file.id}/versions/${selected}`)
      .then((data) => {
        if (!cancelled) setContent((prev) => ({ ...prev, [selected]: data.content }));
      })
      .catch((err) => {
        if (!cancelled) setContentError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [file.id, selected, content]);

  const chosen = versions?.find((v) => v.id === selected) ?? null;
  const chosenText = selected == null ? undefined : content[selected];
  const same = chosenText !== undefined && chosenText === currentContent;

  function choose(id) {
    setContentError("");
    setSelected(id);
  }

  // Up/Down move through the timeline, like a list box
  function onListKeyDown(event) {
    if (!versions?.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = versions.findIndex((v) => v.id === selected);
    const next = event.key === "Home" ? 0 : event.key === "End" ? versions.length - 1 : Math.max(0, Math.min(versions.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    choose(versions[next].id);
    document.getElementById(`${listId}-${versions[next].id}`)?.focus();
  }

  async function restore() {
    setRestoring(true);
    try {
      await beforeRestore?.();
      const result = await apiFetch(`/code-files/${file.id}/versions/${selected}/restore`, { method: "POST" });
      onRestored?.(chosenText);
      toast({ title: "Version restored", description: result.message, tone: "success" });
      setConfirming(false);
      setSelected(null);
      setAttempt((n) => n + 1); // reload: the restore is now the newest version
    } catch (err) {
      toast({ title: "Couldn't restore", description: err.message, tone: "error" });
      setConfirming(false);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Modal title="Version history" description={file.path} size="wide" onClose={restoring ? () => {} : onClose}>
      {loadError && !versions ? (
        <ErrorState title="Couldn't load the history" message={loadError} onRetry={() => { setLoadError(""); setAttempt((n) => n + 1); }} />
      ) : !versions ? (
        <LoadingRegion label="Loading versions…" className="history">
          <div className="history__list" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={52} radius={10} style={{ marginBottom: 8 }} />)}
          </div>
          <div className="history__diff" aria-hidden="true"><Skeleton height={320} /></div>
        </LoadingRegion>
      ) : versions.length === 0 ? (
        <EmptyState icon={<History size={26} />} title="No versions yet">
          Versions are saved as the file changes: at most one a minute, plus whenever everyone stops editing.
        </EmptyState>
      ) : (
        <div className="history">
          <div className="history__list">
            <p className="small muted history__count">{total} version{total === 1 ? "" : "s"}{total > versions.length ? ` (newest ${versions.length})` : ""}</p>
            <ol className="history__timeline motion-stagger" aria-label="Versions, newest first" onKeyDown={onListKeyDown}>
              {versions.map((v, i) => {
                const source = SOURCES[v.source] ?? SOURCES.save;
                const isSelected = v.id === selected;
                return (
                  <li key={v.id} style={{ "--i": Math.min(i, 10) }}>
                    <button
                      type="button"
                      id={`${listId}-${v.id}`}
                      className={`history__item ${isSelected ? "is-selected" : ""}`}
                      aria-pressed={isSelected}
                      tabIndex={isSelected || (selected == null && i === 0) ? 0 : -1}
                      onClick={() => choose(v.id)}
                    >
                      <Avatar name={v.author ?? "?"} size="sm" decorative />
                      <span className="history__meta">
                        <span className="history__who">
                          {v.author ?? "Former member"}
                          {i === 0 && <Badge tone="accent">Latest</Badge>}
                        </span>
                        <span className="history__when small muted">
                          <time dateTime={v.created_at} title={absolute(v.created_at)}>{relativeTime(v.created_at)}</time>
                          {" · "}
                          <source.Icon size={12} aria-hidden="true" /> {source.label}
                        </span>
                        {v.label && <span className="history__label small"><Tag size={12} aria-hidden="true" /> {v.label}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          <section className="history__diff" aria-labelledby={`${listId}-diff-title`}>
            <div className="history__diff-head">
              <h3 id={`${listId}-diff-title`} className="history__diff-title">
                {chosen ? <>Version from <time dateTime={chosen.created_at}>{absolute(chosen.created_at)}</time> → current</> : "Choose a version"}
              </h3>
              {canRestore && chosen && (
                <Button size="sm" icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => setConfirming(true)} disabled={chosenText === undefined || same}>
                  Restore this version
                </Button>
              )}
            </div>
            {!canRestore && <p className="small muted history__note">Viewers can browse the history; owners and editors can restore.</p>}
            {contentError ? (
              <ErrorState compact title="Couldn't load this version" message={contentError} onRetry={() => { setContentError(""); setContent((prev) => { const next = { ...prev }; delete next[selected]; return next; }); }} />
            ) : chosenText === undefined ? (
              <LoadingRegion label="Loading the version…"><Skeleton height={320} /></LoadingRegion>
            ) : same ? (
              <p className="history__same small" role="status">This version matches the current text.</p>
            ) : (
              <div className="history__editor" role="region" aria-label={`Changes from this version to the current text`}>
                <DiffEditor
                  height="100%"
                  language={file.language ?? "plaintext"}
                  original={chosenText}
                  modified={currentContent ?? ""}
                  beforeMount={defineNexusThemes}
                  onMount={nameDiffEditors}
                  theme={monacoTheme(theme)}
                  options={{
                    readOnly: true,
                    renderSideBySide: !narrow,
                    minimap: { enabled: false },
                    fontSize: 13,
                    scrollBeyondLastLine: false,
                    renderOverviewRuler: false,
                    originalAriaLabel: "This version (read only)",
                    modifiedAriaLabel: "The current text (read only)",
                  }}
                />
              </div>
            )}
            <p className="small muted history__legend">Left: this version. Right: the file now.</p>
          </section>
        </div>
      )}

      {confirming && chosen && (
        <ConfirmDialog
          title="Restore this version?"
          message={`${file.path} will go back to the version from ${absolute(chosen.created_at)}, for everyone editing it. Nothing is lost: the current text stays in the history.`}
          confirmLabel="Restore"
          tone="primary"
          busy={restoring}
          onConfirm={restore}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Modal>
  );
}

export default HistoryPanel;
