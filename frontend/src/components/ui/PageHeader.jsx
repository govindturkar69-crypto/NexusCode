// Page title with an optional description and actions on the right. Where you
// are is told by the app shell's breadcrumbs, so there is no kicker above it.
function PageHeader({ title, description, actions, children }) {
  return (
    <header className="page-header">
      <div className="page-header__top">
        <div className="page-header__text">
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-header__description">{description}</p>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export default PageHeader;
