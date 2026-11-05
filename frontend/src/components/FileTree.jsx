import Button from "./ui/Button";

function RowActions({ label, onNewFile, onRename, onDelete }) {
  return (
    <span className="file-tree__actions">
      {onNewFile && <Button variant="ghost" size="icon" aria-label={`New file in ${label}`} title="New file" onClick={onNewFile}>+</Button>}
      <Button variant="ghost" size="icon" aria-label={`Rename ${label}`} title="Rename" onClick={onRename}>✎</Button>
      <Button variant="ghost" size="icon" aria-label={`Delete ${label}`} title="Delete" onClick={onDelete}>✕</Button>
    </span>
  );
}

function Nodes({ nodes, depth, tree }) {
  return (
    <ul className="file-tree__list">
      {nodes.map((node) => {
        const indent = { paddingLeft: `${depth * 0.75 + 0.25}rem` };
        if (node.type === "folder") {
          const collapsed = tree.collapsed.has(node.path);
          return (
            <li key={`folder:${node.path}`}>
              <div className="file-tree__row" style={indent}>
                <button type="button" className="file-tree__name" aria-expanded={!collapsed} onClick={() => tree.onToggleFolder(node.path)}>
                  <span aria-hidden="true">{collapsed ? "▸" : "▾"} 📁</span> {node.name}
                </button>
                {tree.canEdit && (
                  <RowActions
                    label={node.path}
                    onNewFile={() => tree.onNewFile(node.path)}
                    onRename={() => tree.onRenameFolder(node)}
                    onDelete={() => tree.onDeleteFolder(node)}
                  />
                )}
              </div>
              {!collapsed && <Nodes nodes={node.children} depth={depth + 1} tree={tree} />}
            </li>
          );
        }
        const active = tree.activeId === node.file.id;
        return (
          <li key={node.file.id}>
            <div className={`file-tree__row ${active ? "file-tree__row--active" : ""}`} style={indent}>
              <button type="button" className="file-tree__name" aria-current={active ? "true" : undefined} onClick={() => tree.onOpen(node.file)}>
                {node.name}
              </button>
              {tree.canEdit && (
                <RowActions label={node.path} onRename={() => tree.onRenameFile(node.file)} onDelete={() => tree.onDeleteFile(node.file)} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// `tree` carries what every row needs: canEdit, activeId, collapsed and the callbacks
function FileTree({ nodes, ...tree }) {
  return (
    <nav aria-label="Project files" className="file-tree">
      <Nodes nodes={nodes} depth={0} tree={tree} />
    </nav>
  );
}

export default FileTree;
