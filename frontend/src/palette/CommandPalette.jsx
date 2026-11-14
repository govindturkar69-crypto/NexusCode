import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  ChartColumn, CheckSquare, CodeXml, CornerDownLeft, FileCode2, FolderKanban, History, LayoutGrid, MessageSquare,
  Search, Settings, Sparkles, SquarePlus, Video, Zap,
} from "lucide-react";
import { downloadProjectZip } from "../api/archive";
import { useAuth } from "../auth/useAuth";
import { motionAllowed, setMotionPreference } from "../motion/motion";
import { useTheme } from "../theme/useTheme";
import { useToast } from "../components/ui/toastContext";
import { fuzzyMatch, highlight } from "./fuzzy";
import { buildItems, GROUP_ORDER, loadProjectData } from "./items";
import { loadRecents, rememberRecent } from "./recents";
import "../styles/palette.css";

const PER_GROUP = 6;
const ICONS = {
  nav: LayoutGrid, action: Zap, project: FolderKanban, task: CheckSquare, file: FileCode2,
  "nav:editor": CodeXml, "nav:chat": MessageSquare, "nav:meeting": Video, "nav:analytics": ChartColumn,
  "nav:settings": Settings, "nav:ai": Sparkles, "act:new-task": SquarePlus, "act:new-file": SquarePlus,
};
const iconFor = (item) => ICONS[item.key.split(":").slice(0, 2).join(":")] ?? ICONS[item.kind] ?? Search;

function Label({ text, indices }) {
  if (!indices?.length) return text;
  // Plain inline spans, so the option's accessible name is the label as written
  return highlight(text, indices).map((part, i) => <span key={i} className={part.match ? "palette__match" : undefined}>{part.text}</span>);
}

/**
 * The command palette: an ARIA combobox (input + listbox) in a modal dialog.
 * Up/Down move, Enter runs, Escape closes, Tab stays in the dialog. Focus goes
 * back where it was on close.
 */
function CommandPalette({ onClose, project, projects }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { toggleTheme } = useTheme();
  const toast = useToast();
  const id = useId();
  const input = useRef(null);
  const list = useRef(null);
  const returnTo = useRef(typeof document !== "undefined" ? document.activeElement : null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState(loadRecents);
  const [data, setData] = useState({ tasks: [], files: [] });
  const [loadingFor, setLoadingFor] = useState(project ? project.id : null);
  const [loadError, setLoadError] = useState("");
  const [motionReduced] = useState(() => !motionAllowed());

  // Tasks and files of the current project (cached for a minute)
  useEffect(() => {
    if (!project) return undefined;
    let cancelled = false;
    loadProjectData(project.id)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't load this project's tasks and files.");
      })
      .finally(() => {
        if (!cancelled) setLoadingFor(null);
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

  useEffect(() => {
    input.current?.focus();
    const previous = returnTo.current;
    return () => previous?.focus?.();
  }, []);

  const items = useMemo(
    () =>
      buildItems({
        project,
        projects: projects ?? [],
        tasks: data.tasks,
        files: data.files,
        navigate,
        toggleTheme,
        motionReduced,
        toggleMotion: () => setMotionPreference(motionReduced ? "full" : "reduce"),
        signOut: () => {
          signOut();
          navigate("/login", { replace: true });
        },
        exportProject: (projectId) => {
          toast({ title: "Preparing the ZIP…", tone: "info" });
          downloadProjectZip(projectId)
            .then(({ name }) => toast({ title: "Downloaded", description: name, tone: "success" }))
            .catch((err) => toast({ title: "Couldn't export the project", description: err.message, tone: "error" }));
        },
      }),
    [project, projects, data, navigate, toggleTheme, motionReduced, signOut, toast],
  );

  // Filter, score, group. Empty query: recent items first, then everything grouped.
  const groups = useMemo(() => {
    const byKey = new Map(items.map((item) => [item.key, item]));
    const out = [];
    if (!query.trim()) {
      const recent = recents.map((r) => byKey.get(r.key)).filter(Boolean);
      if (recent.length) out.push({ name: "Recent", items: recent.map((item) => ({ item, indices: [] })) });
      for (const name of GROUP_ORDER.slice(1)) {
        const inGroup = items.filter((item) => item.group === name && !recent.includes(item));
        if (inGroup.length) out.push({ name, items: inGroup.slice(0, name === "Tasks" || name === "Files" ? 4 : PER_GROUP).map((item) => ({ item, indices: [] })) });
      }
      return out;
    }
    const scored = [];
    for (const item of items) {
      const onLabel = fuzzyMatch(query, item.label);
      // Keywords (synonyms) can match too, but not the hint: it's often the project's
      // name, which would make every page and action match a search for it
      const onRest = onLabel || !item.keywords ? null : fuzzyMatch(query, item.keywords);
      if (onLabel) scored.push({ item, indices: onLabel.indices, score: onLabel.score + 50 });
      else if (onRest) scored.push({ item, indices: [], score: onRest.score * 0.5 });
    }
    for (const name of GROUP_ORDER.slice(1)) {
      const inGroup = scored.filter((s) => s.item.group === name).sort((a, b) => b.score - a.score).slice(0, PER_GROUP);
      if (inGroup.length) out.push({ name, items: inGroup });
    }
    return out;
  }, [items, recents, query]);

  const flat = groups.flatMap((g) => g.items.map((entry) => entry.item));
  const activeIndex = flat.length ? Math.min(active, flat.length - 1) : -1;
  const optionId = (index) => `${id}-option-${index}`;

  useEffect(() => {
    if (activeIndex >= 0) document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: "nearest" });
  });

  function run(item) {
    setRecents(rememberRecent({ key: item.key, label: item.label, hint: item.hint ?? "", kind: item.kind }));
    // Close first, so focus goes back to the page before navigating
    onClose();
    item.run();
  }

  function onKeyDown(event) {
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      setActive(flat.length ? (activeIndex + 1) % flat.length : 0);
    } else if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      setActive(flat.length ? (activeIndex - 1 + flat.length) % flat.length : 0);
    } else if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      const step = event.key === "PageDown" ? 5 : -5;
      setActive(Math.max(0, Math.min(flat.length - 1, activeIndex + step)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0) run(flat[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Tab") {
      // The input is the only stop in the dialog: keep focus here
      event.preventDefault();
    }
  }

  const loading = loadingFor !== null;
  let index = -1;
  const resultCount = flat.length;

  return createPortal(
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette__search">
          <Search size={17} aria-hidden="true" />
          <input
            ref={input}
            className="palette__input"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-label="Search projects, tasks, files and actions"
            placeholder={project ? `Search ${project.name}, pages and actions…` : "Search projects, pages and actions…"}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="palette__kbd">Esc</kbd>
        </div>

        <div ref={list} id={`${id}-list`} role="listbox" aria-label="Results" className="palette__list">
          {groups.map((group) => (
            <div key={group.name} role="group" aria-labelledby={`${id}-${group.name}`} className="palette__group">
              <div id={`${id}-${group.name}`} className="palette__group-label" role="presentation">
                {group.name === "Recent" && <History size={12} aria-hidden="true" />} {group.name}
              </div>
              {group.items.map(({ item, indices }) => {
                index += 1;
                const i = index;
                const Icon = iconFor(item);
                return (
                  <div
                    key={item.key}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={`palette__option ${i === activeIndex ? "is-active" : ""}`}
                    onMouseMove={() => i !== activeIndex && setActive(i)}
                    onClick={() => run(item)}
                  >
                    <Icon size={16} className="palette__icon" aria-hidden="true" />
                    <span className="palette__label"><Label text={item.label} indices={indices} /></span>
                    {item.hint && <span className="palette__hint"><span className="visually-hidden">, </span>{item.hint}</span>}
                    {i === activeIndex && <CornerDownLeft size={14} className="palette__enter" aria-hidden="true" />}
                  </div>
                );
              })}
            </div>
          ))}
          {resultCount === 0 && !loading && (
            <div className="palette__empty" role="presentation">
              <p>No results for “{query.trim()}”.</p>
              <p className="small muted">Try a page name like “board”, an action like “new task”, or part of a file path.</p>
            </div>
          )}
          {loading && <div className="palette__loading" role="presentation"><span className="spinner-dot" aria-hidden="true" /> Loading tasks and files…</div>}
          {loadError && <div className="palette__loading" role="presentation">{loadError}</div>}
        </div>

        <div className="palette__footer" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          <span><kbd>↵</kbd> to open</span>
          <span><kbd>Esc</kbd> to close</span>
        </div>
        <p className="visually-hidden" role="status" aria-live="polite">
          {loading ? "Loading tasks and files." : `${resultCount} result${resultCount === 1 ? "" : "s"}.`}
        </p>
      </div>
    </div>,
    document.body,
  );
}

export default CommandPalette;
