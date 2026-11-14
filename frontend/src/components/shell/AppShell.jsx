import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, Outlet, matchPath, useLocation, useNavigate } from "react-router-dom";
import {
  ChartColumn,
  Check,
  ChevronRight,
  ChevronsUpDown,
  CodeXml,
  FolderKanban,
  LogOut,
  Menu as MenuIcon,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  SquareKanban,
  Video,
  X,
} from "lucide-react";
import { apiFetchAll } from "../../api/client";
import { startGithubLink } from "../../api/github";
import { useAuth } from "../../auth/useAuth";
import GithubIcon from "../icons/GithubIcon";
import NotificationBell from "../NotificationBell";
import ThemeToggle from "../ThemeToggle";
import Avatar from "../ui/Avatar";
import Menu from "../ui/Menu";
import { useToast } from "../ui/toastContext";

const PROJECT_PAGES = { "": "Board", editor: "Code editor", meeting: "Video meeting" };
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
  const [projects, setProjects] = useState(null);
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
    startGithubLink().catch((err) => toast({ title: "Couldn't connect GitHub", description: err.message, tone: "error" }));
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
            <NotificationBell />
            <ThemeToggle />
            {user && (
              <Menu
                label="Account"
                items={[
                  { label: "Settings", icon: <SettingsIcon size={14} aria-hidden="true" />, onSelect: () => navigate("/settings") },
                  { label: "Connect GitHub", icon: <GithubIcon size={14} />, onSelect: connectGithub },
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
    </div>
  );
}

export default AppShell;
