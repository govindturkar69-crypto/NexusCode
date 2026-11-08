// The project's Python files for a run, so one file can import another. They're
// written into the Python worker's in-memory filesystem; nothing leaves the browser.

export const MAX_PROJECT_FILES = 200;
export const MAX_PROJECT_CHARS = 2_000_000;

export function isPythonPath(path) {
  return path.toLowerCase().endsWith(".py");
}

/**
 * paths: every project path. read(path) -> content (null to skip). The file being
 * run is always included, with `code` (the editor's text, saved or not). Files that
 * can't be read are left out; if the project is too big, only the file itself runs.
 */
export async function collectPythonFiles(paths, read, mainPath, code) {
  const others = paths.filter((path) => isPythonPath(path) && path !== mainPath);
  if (others.length === 0 || others.length + 1 > MAX_PROJECT_FILES) return [];
  const files = [{ path: mainPath, content: code }];
  let total = code.length;
  const contents = await Promise.all(others.map((path) => Promise.resolve(read(path)).catch(() => null)));
  others.forEach((path, index) => {
    const content = contents[index];
    if (typeof content !== "string") return;
    total += content.length;
    files.push({ path, content });
  });
  return total > MAX_PROJECT_CHARS ? [] : files;
}
