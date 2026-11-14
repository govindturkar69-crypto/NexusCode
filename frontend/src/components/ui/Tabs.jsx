import { useId, useRef } from "react";

// WAI-ARIA tabs: role="tablist"/"tab"/"tabpanel", one tab in the Tab order, arrow
// keys (and Home/End) move between tabs and select them. Controlled:
//   tabs: [{ id, label, icon, badge }], value, onChange(id), children(activeId) -> panel
function Tabs({ label, tabs, value, onChange, children, className = "", fill = false }) {
  const base = useId();
  const listRef = useRef(null);
  const tabId = (id) => `${base}-tab-${id}`;
  const panelId = (id) => `${base}-panel-${id}`;

  function onKeyDown(event) {
    const index = tabs.findIndex((t) => t.id === value);
    let next = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].id);
    listRef.current?.querySelector(`#${CSS.escape(tabId(tabs[next].id))}`)?.focus();
  }

  return (
    <div className={`tabs ${className}`}>
      <div ref={listRef} role="tablist" aria-label={label} className={`tabs__list ${fill ? "tabs__list--fill" : ""}`} onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.id === value;
          return (
            <button
              key={tab.id}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId(tab.id)}
              tabIndex={selected ? 0 : -1}
              className={`tabs__tab ${selected ? "is-selected" : ""}`}
              onClick={() => onChange(tab.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge != null && <span className="tabs__badge">{tab.badge}</span>}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId(value)} aria-labelledby={tabId(value)} className="tabs__panel motion-fade-in" key={value} tabIndex={0}>
        {children(value)}
      </div>
    </div>
  );
}

export default Tabs;
