"""
Rules for code file paths. A path like src/app/main.py is a file; folders exist
only as the slashes in paths, so an empty folder can't be stored.
"""
import posixpath
import unicodedata

MAX_PATH_LENGTH = 255
MAX_SEGMENT_LENGTH = 100
FORBIDDEN_CHARACTERS = set('\\<>:"|?*')
# Git refuses these, so a project containing one could never be pushed
FORBIDDEN_SEGMENTS = {".", "..", ".git"}

# Values are Monaco language ids, so the editor can use them directly
EXTENSION_LANGUAGES = {
    ".py": "python",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".java": "java",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".go": "go",
    ".rs": "rust",
    ".rb": "ruby",
    ".php": "php",
    ".kt": "kotlin",
    ".swift": "swift",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".less": "less",
    ".json": "json",
    ".md": "markdown",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".xml": "xml",
    ".sql": "sql",
    ".sh": "shell",
    ".bash": "shell",
    ".ps1": "powershell",
    ".ini": "ini",
}
PLAIN_TEXT = "plaintext"


def path_problem(path: str) -> str | None:
    """Why this can't be a path, or None if it's fine."""
    if not path:
        return "A name is required."
    if len(path) > MAX_PATH_LENGTH:
        return f"Paths can be at most {MAX_PATH_LENGTH} characters long."
    if path != path.strip():
        return "A path can't start or end with a space."
    if path.startswith("/") or path.endswith("/"):
        return "A path can't start or end with '/'."
    if any(c in FORBIDDEN_CHARACTERS or unicodedata.category(c) == "Cc" for c in path):
        return "A path can't contain \\ < > : \" | ? * or control characters."
    for segment in path.split("/"):
        if not segment:
            return "A path can't contain '//'."
        if segment != segment.strip():
            return "A file or folder name can't start or end with a space."
        if segment in FORBIDDEN_SEGMENTS:
            return f"'{segment}' can't be used as a file or folder name."
        if len(segment) > MAX_SEGMENT_LENGTH:
            return f"File and folder names can be at most {MAX_SEGMENT_LENGTH} characters long."
    return None


def language_for_path(path: str) -> str:
    name = posixpath.basename(path)
    if name.lower() == "dockerfile":
        return "dockerfile"
    return EXTENSION_LANGUAGES.get(posixpath.splitext(name)[1].lower(), PLAIN_TEXT)


def path_conflict(path: str, others) -> str | None:
    """Why `path` can't sit alongside the other paths, or None. A name can't be
    both a file and a folder, in either direction."""
    for other in others:
        if other == path:
            return f"{path} already exists."
        if other.startswith(f"{path}/"):
            return f"{path} is already a folder."
        if path.startswith(f"{other}/"):
            return f"{other} is a file, so it can't contain other files."
    return None
