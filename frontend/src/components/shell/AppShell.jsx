import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, Outlet, matchPath, useLocation, useNavigate } from "react-router-dom";
import { ChartColumn, Check, Keyboard, Rocket, ChevronRight, ChevronsUpDown, CodeXml, FolderKanban, LogOut, Menu as MenuIcon, Search, Settings as SettingsIcon, ShieldCheck, Sparkles, SquareKanban, Video, X } from "lucide-react";
import { apiFetchAll } from "../../api/client";
import { markDone, readTour, shouldOfferTour, stepsDoneByVisiting, writeTour } from "../../onboarding/tour";
import { rememberProject } from "../../projects/home";
import { isTypingTarget, plainKey, sequenceHandler } from "../../shortcuts/shortcuts";
import { useTheme } from "../../theme/useTheme";
import { useAuth } from "../../auth/useAuth";
import GithubIcon from "../icons/GithubIcon";
import NotificationBell from "../NotificationBell";
import ThemeToggle from "../ThemeToggle";
import Avatar from "../ui/Avatar";
import Menu from "../ui/Menu";
import { useToast } from "../ui/toastContext";

// Loaded on first open: nothing of it is in the main bundle
const CommandPalette = lazy(() => import("../../palette/CommandPalette"));
const ShortcutsDialog = lazy(() => import("../../shortcuts/ShortcutsDialog"));
const WelcomeTour = lazy(() => import("../../onboarding/WelcomeTour"));
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const PROJECT_PAGES = { "": "Board", editor: "Code editor", meeting: "Video meeting", analytics: "Analytics" };
const TOP_PAGES = { "/projects": "Projects", "/dashboard": "Dashboard", "/ai": "AI Assistant", "/settings": "Settings", "/admin": "Admin" };

function useProjectRoute(pathname) {
  const match = matchPath("/projects/:projectId/*", pathname);
  if (!match) return null;
  return { id: Number(match.params.projectId), page: match.params["*"] ?? "" };
}

function SideLink({ to, icon: Icon, children, end = false }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `side-link ${isActive ? "is-active" : ""}`}>
      <Icon size={16} aria-hidden="true" />
      <span>{children}</span>
    </NavLink>
  );
}

// The frame around every signed-in page: sidebar navigation (a drawer on small
// screens), a header with breadcrumbs, notifications, theme and the user menu, and
// the page itself, which fades in on each route change.
function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const toast = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { toggleTheme } = useTheme();

  // Ctrl/Cmd+K opens the command palette from anywhere, form fields included,
  // except inside the Monaco editor: there Ctrl/Cmd+K starts Monaco's own
  // two-key shortcuts (Ctrl+K Ctrl+C comments a line, and so on), so the
  // palette leaves it alone and opens from the header's Search button instead.
  useEffect(() => {
    function onKeyDown(event) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") return;
      if (event.target instanceof Element && event.target.closest(".monaco-editor")) return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const [projects, setProjects] = useState(null);

  // Single-key shortcuts (see shortcuts/shortcuts.js): only when not typing, and
  // not while a dialog is open (it has its own keys)
  useEffect(() => {
    // "g then x": go to a page; b, e and m need a project in the address
    const sequence = sequenceHandler((letter) => {
      const route = matchPath("/projects/:projectId/*", pathname);
      const base = route ? `/projects/${route.params.projectId}` : null;
      const targets = { p: "/projects", d: "/dashboard", a: "/ai", s: "/settings", b: base, e: base && `${base}/editor`, m: base && `${base}/meeting` };
      if (!targets[letter]) return false;
      navigate(targets[letter]);
      return true;
    });
    function onKeyDown(event) {
      if (event.defaultPrevented || isTypingTarget(event.target) || document.querySelector('[role="dialog"]')) return;
      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if (plainKey(event, "t", { shift: true })) {
        event.preventDefault();
        toggleTheme();
      } else if (sequence(event)) {
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleTheme, navigate, pathname]);
  const sidebarId = useId();
  const menuButtonRef = useRef(null);
  const sidebarRef = useRef(null);
  const mainRef = useRef(null);
  const firstRender = useRef(true);
  const projectRoute = useProjectRoute(pathname);
  const currentProject = projectRoute && projects?.find((p) => p.id === projectRoute.id);

  const loadProjects = useCallback(() => {
    apiFetchAll("/projects", "projects").then(setProjects).catch(() => setProjects((p) => p ?? []));
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Welcome tour: offered to people with no projects yet; steps tick themselves
  // off as they're visited. Progress is per user, on this device.
  const username = user?.username;
  const [tour, setTour] = useState(null); // { username, state, open }
  if (username && projects && tour?.username !== username) {
    const state = readTour(username);
    setTour({ username, state, open: shouldOfferTour(state, projects.length) });
  }
  const projectCount = projects?.length ?? 0;
  if (tour) {
    const visited = stepsDoneByVisiting(pathname, projectCount);
    if (visited.some((id) => !tour.state.done.includes(id))) {
      setTour({ ...tour, state: visited.reduce(markDone, tour.state) });
    }
  }
  const tourState = tour?.state;
  useEffect(() => {
    if (username && tourState) writeTour(username, tourState);
  }, [username, tourState]);
  const updateTour = useCallback((change) => setTour((current) => (current ? change(current) : current)), []);
  const openTour = useCallback(() => updateTour((t) => ({ ...t, open: true, state: { ...t.state, dismissed: false } })), [updateTour]);

  // The dashboard lists recently opened projects first
  const openedProjectId = projectRoute?.id;
  useEffect(() => {
    if (openedProjectId && user?.username) rememberProject(user.username, openedProjectId);
  }, [openedProjectId, user?.username]);

  // A project we don't know yet (just created, or just added to): refresh the list
  useEffect(() => {
    if (projectRoute && projects && !projects.some((p) => p.id === projectRoute.id)) loadProjects();
  }, [projectRoute, projects, loadProjects]);

  // On navigation the drawer closes (adjusted during render, not in an effect)
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setDrawerOpen(false);
  }

  // ...and the page scrolls to the top and takes focus, so screen readers start at
  // the new content (not on the first load)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo?.(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  // The drawer: Escape closes it and focus goes back to the menu button
  useEffect(() => {
    if (!drawerOpen) return undefined;
    sidebarRef.current?.querySelector("a, button")?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  function logout() {
    signOut();
    navigate("/login");
  }

  function connectGithub() {
    // Loaded on click: it isn't needed for anything else in the shell
    import("../../api/github")
      .then(({ startGithubLink }) => startGithubLink())
      .catch((err) => toast({ title: "Couldn't connect GitHub", description: err.message, tone: "error" }));
  }

  const crumbs = [];
  if (projectRoute) {
    crumbs.push({ to: "/projects", label: "Projects" });
    crumbs.push({ to: `/projects/${projectRoute.id}`, label: currentProject?.name ?? "Project" });
    if (projectRoute.page) crumbs.push({ label: PROJECT_PAGES[projectRoute.page] ?? projectRoute.page });
  } else if (TOP_PAGES[pathname]) {
    crumbs.push({ label: TOP_PAGES[pathname] });
  }

  const switcherItems = (projects ?? []).slice(0, 12).map((p) => ({
    label: p.name,
    icon: p.id === projectRoute?.id ? <Check size={14} aria-hidden="true" /> : <span className="menu__icon-space" aria-hidden="true" />,
    onSelect: () => navigate(`/projects/${p.id}${projectRoute?.page ? `/${projectRoute.page}` : ""}`),
  }));
  switcherItems.push({ separator: true }, { label: "All projects", icon: <FolderKanban size={14} aria-hidden="true" />, onSelect: () => navigate("/projects") });

  return (
    <div className={`app-shell ${drawerOpen ? "drawer-open" : ""}`}>
      <a href="#main" className="skip-link">Skip to main content</a>

      <aside id={sidebarId} ref={sidebarRef} className="sidebar" aria-label="Sidebar">
        <div className="sidebar__brand">
          <Link to="/projects" className="brand">
            <span className="brand__mark" aria-hidden="true">N</span>
            <span className="brand__name">Nexus<span>Code</span></span>
            <span className="visually-hidden"> home</span>
          </Link>
          <button type="button" className="sidebar__close btn btn--subtle btn--icon" onClick={() => setDrawerOpen(false)} aria-label="Close navigation">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Main" className="sidebar__nav">
          <SideLink to="/projects" icon={FolderKanban} end>Projects</SideLink>
          <SideLink to="/dashboard" icon={ChartColumn}>Dashboard</SideLink>
          <SideLink to="/ai" icon={Sparkles}>AI Assistant</SideLink>
          <SideLink to="/settings" icon={SettingsIcon}>Settings</SideLink>
          {user?.is_admin && <SideLink to="/admin" icon={ShieldCheck}>Admin</SideLink>}
        </nav>

        {projectRoute && (
          <div className="sidebar__project">
            <Menu
              label="Switch project"
              align="start"
              className="project-switcher"
              menuClassName="project-switcher__menu"
              items={switcherItems}
              renderTrigger={(props) => (
                <button type="button" className="project-switcher__button" {...props} aria-label={undefined}>
                  <span className="project-switcher__avatar" aria-hidden="true">{(currentProject?.name ?? "?").slice(0, 1).toUpperCase()}</span>
                  {/* The name is read from the visible text, so voice control can say it */}
                  <span className="visually-hidden">Project: </span>
                  <span className="project-switcher__name">{currentProject?.name ?? "Project"}</span>
                  <span className="visually-hidden">. Switch project</span>
                  <ChevronsUpDown size={14} aria-hidden="true" />
                </button>
              )}
            />
            <nav aria-label="Project" className="sidebar__nav">
              <SideLink to={`/projects/${projectRoute.id}`} icon={SquareKanban} end>Board</SideLink>
              <SideLink to={`/projects/${projectRoute.id}/editor`} icon={CodeXml}>Code editor</SideLink>
              <SideLink to={`/projects/${projectRoute.id}/meeting`} icon={Video}>Video meeting</SideLink>
              <SideLink to={`/projects/${projectRoute.id}/analytics`} icon={ChartColumn}>Analytics</SideLink>
            </nav>
          </div>
        )}
      </aside>

      {/* Escape closes the drawer from the keyboard; the backdrop is for pointers */}
      <div className="drawer-backdrop" aria-hidden="true" onClick={() => setDrawerOpen(false)} />

      {/* While the drawer is open the page behind it can't be reached */}
      <div className="app-frame" inert={drawerOpen || undefined}>
        <header className="app-header">
          <button
            ref={menuButtonRef}
            type="button"
            className="app-header__menu btn btn--subtle btn--icon"
            aria-label="Open navigation"
            aria-controls={sidebarId}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon size={18} aria-hidden="true" />
          </button>

          <nav aria-label="Breadcrumb" className="breadcrumbs">
            <ol>
              {crumbs.map((crumb, i) => (
                <li key={`${crumb.label}-${i}`}>
                  {i > 0 && <ChevronRight size={14} className="breadcrumbs__sep" aria-hidden="true" />}
                  {crumb.to && i < crumbs.length - 1 ? (
                    <Link to={crumb.to}>{crumb.label}</Link>
                  ) : (
                    <span aria-current="page">{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>

          <div className="app-header__actions">
            <button type="button" className="palette-trigger" onClick={() => setPaletteOpen(true)} aria-haspopup="dialog" aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}>
              <Search size={15} aria-hidden="true" />
              <span className="palette-trigger__label">Search</span>
              <kbd className="palette-trigger__kbd" aria-hidden="true">{isMac ? "⌘K" : "Ctrl K"}</kbd>
            </button>
            <NotificationBell />
            <ThemeToggle />
            {user && (
              <Menu
                label="Account"
                items={[
                  { label: "Settings", icon: <SettingsIcon size={14} aria-hidden="true" />, onSelect: () => navigate("/settings") },
                  { label: "Connect GitHub", icon: <GithubIcon size={14} />, onSelect: connectGithub },
                  { label: "Getting started", icon: <Rocket size={14} aria-hidden="true" />, onSelect: openTour },
                  { label: "Keyboard shortcuts", icon: <Keyboard size={14} aria-hidden="true" />, onSelect: () => setShortcutsOpen(true), hint: "?" },
                  { separator: true },
                  { label: "Log out", icon: <LogOut size={14} aria-hidden="true" />, onSelect: logout, keepFocus: true },
                ]}
                header={
                  <div className="user-menu__header">
                    <Avatar name={user.username} size="md" decorative />
                    <div>
                      <p className="user-menu__name">{user.username}</p>
                      {user.email && <p className="user-menu__email">{user.email}</p>}
                    </div>
                  </div>
                }
                renderTrigger={(props) => (
                  <button type="button" className="user-menu__trigger" {...props} aria-label={undefined}>
                    <Avatar name={user.username} size="sm" decorative />
                    <span className="visually-hidden">Account menu for {user.username}</span>
                  </button>
                )}
              />
            )}
          </div>
        </header>

        <main id="main" ref={mainRef} tabIndex={-1} className="app-main">
          <div key={pathname} className="page-transition">
            <Outlet />
          </div>
        </main>
      </div>
      {tour?.open && (
        <Suspense fallback={null}>
          <WelcomeTour
            state={tour.state}
            project={currentProject ?? projects?.[0] ?? null}
            onDone={(id) => updateTour((t) => ({ ...t, state: markDone(t.state, id) }))}
            onClose={() => updateTour((t) => ({ ...t, open: false, state: { ...t.state, dismissed: true } }))}
            onOpenPalette={() => setPaletteOpen(true)}
          />
        </Suspense>
      )}
      {shortcutsOpen && (
        <Suspense fallback={null}>
          <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />
        </Suspense>
      )}
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette onClose={() => setPaletteOpen(false)} onShowShortcuts={() => setShortcutsOpen(true)} onShowTour={openTour} project={currentProject ?? null} projects={projects} />
        </Suspense>
      )}
    </div>
  );
}

export default AppShell;
