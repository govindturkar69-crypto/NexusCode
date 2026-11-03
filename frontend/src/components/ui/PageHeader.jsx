// "$ eyebrow" line, page title, and optional actions on the right.
// tone: accent (default) | danger | success
function PageHeader({ eyebrow, title, actions, tone, children }) {
  return (
    <header className="page-header">
      <div className="page-header__top">
        <div>
          {eyebrow && <div className={`eyebrow ${tone ? `eyebrow--${tone}` : ""}`}>$ {eyebrow}</div>}
          <h1 className="page-title">{title}</h1>
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export default PageHeader;
