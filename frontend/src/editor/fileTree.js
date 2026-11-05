// Turns flat file paths into a tree, with no React in it. Folders exist only as
// slashes in paths, plus any empty ones the user just made (`extraFolders`),
// which live in the browser until a file is created inside them.

function folderNode(name, path) {
  return { type: "folder", name, path, children: [], hasFiles: false };
}

function ensureFolder(root, folders, path) {
  if (folders.has(path)) return folders.get(path);
  const slash = path.lastIndexOf("/");
  const parent = slash === -1 ? root : ensureFolder(root, folders, path.slice(0, slash));
  const node = folderNode(path.slice(slash + 1), path);
  parent.children.push(node);
  folders.set(path, node);
  return node;
}

function sortChildren(node) {
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children.filter((child) => child.type === "folder").forEach(sortChildren);
}

export function buildTree(files, extraFolders = []) {
  const root = folderNode("", "");
  const folders = new Map();
  for (const file of files) {
    const slash = file.path.lastIndexOf("/");
    const parent = slash === -1 ? root : ensureFolder(root, folders, file.path.slice(0, slash));
    parent.children.push({ type: "file", name: file.path.slice(slash + 1), path: file.path, file });
    for (let at = slash; at !== -1; at = file.path.lastIndexOf("/", at - 1)) {
      folders.get(file.path.slice(0, at)).hasFiles = true;
    }
  }
  extraFolders.forEach((path) => ensureFolder(root, folders, path));
  sortChildren(root);
  return root.children;
}

export function isInFolder(path, folder) {
  return path.startsWith(`${folder}/`);
}

export function baseName(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

// Moves empty folders along when their parent is renamed
export function renameFolderPath(path, from, to) {
  if (path === from) return to;
  return isInFolder(path, from) ? to + path.slice(from.length) : path;
}
