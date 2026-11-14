"""
A project's code as a ZIP: export (any member) and import (owner and editor).

Export, built on the server and streamed:
    README.md      the project's name, description and what's inside
    tasks.json     tasks without user emails, tokens or anything secret
    code/<path>    every code file, in its folders
Built here rather than in the browser: the file list API leaves out contents,
so a browser would need one request per file plus a ZIP library; here it is one
request and the permission check stays in one place.

Import never trusts the archive. Every entry is checked before anything is
written:
- the upload, the entry count and the uncompressed sizes are capped, and each
  entry is read through a limit (a lying header can't get past it), so zip
  bombs stop early;
- symlinks, directories, absolute paths, "..", backslashes and anything else
  path_problem() rejects are refused, so nothing can escape the project
  (zip-slip);
- only UTF-8 text without NUL bytes is accepted; binaries are skipped and
  reported;
- an existing path is a duplicate, skipped or renamed as the user chose, and a
  file/folder clash is reported;
- the project's file limit still applies.
A NexusCode export (README.md + tasks.json + code/) imports its code/ folder.
Any other archive whose files all sit in one top folder has that folder dropped.
"""
import io
import json
import posixpath
import re
import stat
import zipfile
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.services.code_paths import language_for_path, path_conflict, path_problem

MAX_ARCHIVE_BYTES = 5 * 1024 * 1024  # the upload itself
MAX_ENTRIES = 300  # entries in the archive, folders included
MAX_FILE_BYTES = 1_000_000  # matches MAX_CODE_FILE_CHARS for one code file
MAX_TOTAL_BYTES = 10 * 1024 * 1024  # all files, uncompressed
MAX_RATIO = 200  # uncompressed / compressed, per entry

JUNK_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
JUNK_FOLDERS = {"__MACOSX", ".git", "node_modules", "__pycache__"}
BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip", ".gz", ".tar", ".7z", ".rar",
    ".exe", ".dll", ".so", ".dylib", ".class", ".jar", ".pyc", ".o", ".a", ".woff", ".woff2", ".ttf", ".otf",
    ".mp3", ".mp4", ".mov", ".wav", ".ogg", ".webm", ".sqlite", ".db", ".bin",
}


class ArchiveError(ValueError):
    """The archive as a whole can't be imported (shown to the user as is)."""


@dataclass
class Entry:
    path: str  # where it would go in the project (or the raw name, if rejected)
    status: str  # "new" | "duplicate" | "skipped"
    size: int = 0
    reason: str | None = None
    content: str | None = field(default=None, repr=False)


def _safe_filename(name: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-.")[:60]
    return slug or "project"


def export_filename(project_name: str, now: datetime | None = None) -> str:
    stamp = (now or datetime.now(UTC)).strftime("%Y-%m-%d")
    return f"{_safe_filename(project_name)}-{stamp}.zip"


def build_export(project, tasks, code_files, member_count: int, now: datetime | None = None) -> bytes:
    """tasks: (task, assignee username or None) pairs; code_files: CodeFileModel rows."""
    now = now or datetime.now(UTC)
    task_list = [
        {
            "id": task.id,
            "title": task.title,
            "description": task.description,
            "status": task.status,
            "priority": task.priority,
            "due_date": task.due_date.isoformat() if task.due_date else None,
            "assignee": assignee,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "updated_at": task.updated_at.isoformat() if task.updated_at else None,
        }
        for task, assignee in tasks
    ]
    readme = "\n".join(
        [
            f"# {project.name}",
            "",
            project.description or "_No description._",
            "",
            f"Exported from NexusCode on {now.strftime('%Y-%m-%d %H:%M UTC')}.",
            "",
            f"- `code/`: {len(code_files)} code file{'s' if len(code_files) != 1 else ''}, in their folders",
            f"- `tasks.json`: {len(task_list)} task{'s' if len(task_list) != 1 else ''} (assignees by username)",
            f"- Members: {member_count}",
            "",
            "No passwords, emails or access tokens are included.",
            "To bring the code into another project, use Import ZIP in its code editor.",
            "",
        ]
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("README.md", readme)
        archive.writestr("tasks.json", json.dumps({"project": project.name, "exported_at": now.isoformat(), "tasks": task_list}, indent=2, ensure_ascii=False))
        for code_file in code_files:
            archive.writestr(f"code/{code_file.path}", code_file.content or "")
    return buffer.getvalue()


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    return stat.S_ISLNK(info.external_attr >> 16)


def _read_limited(archive: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int) -> bytes | None:
    """The entry's bytes, or None if it is bigger than `limit` (whatever its header says)."""
    with archive.open(info) as handle:
        data = handle.read(limit + 1)
    return None if len(data) > limit else data


def _strip_prefix(names: list[str]) -> str:
    """The folder to drop from every name: code/ for a NexusCode export, else a single top folder."""
    files = [n for n in names if not n.endswith("/")]
    if "tasks.json" in files and "README.md" in files and any(n.startswith("code/") for n in files):
        return "code/"
    tops = {n.split("/", 1)[0] for n in files if "/" in n}
    if len(tops) == 1 and all("/" in n for n in files):
        return f"{tops.pop()}/"
    return ""


def free_name(path: str, taken: set[str]) -> str:
    """path with -2, -3 ... before the extension, the first one not taken."""
    folder, name = posixpath.split(path)
    stem, ext = posixpath.splitext(name)
    if not stem:  # a dotfile like .env
        stem, ext = name, ""
    n = 2
    while True:
        candidate = posixpath.join(folder, f"{stem}-{n}{ext}") if folder else f"{stem}-{n}{ext}"
        if candidate not in taken and not path_conflict(candidate, taken):
            return candidate
        n += 1


def analyze(data: bytes, existing_paths: list[str], capacity: int) -> list[Entry]:
    """Every entry with what would happen to it. Raises ArchiveError for an archive that can't be used at all."""
    if len(data) > MAX_ARCHIVE_BYTES:
        raise ArchiveError(f"The ZIP is larger than {MAX_ARCHIVE_BYTES // (1024 * 1024)} MB.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ArchiveError("That isn't a valid ZIP file.") from None
    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_ENTRIES:
            raise ArchiveError(f"The ZIP has {len(infos)} entries; at most {MAX_ENTRIES} can be imported at once.")
        if sum(info.file_size for info in infos) > MAX_TOTAL_BYTES * 4:
            # Far over the limit by its own account: don't even start reading
            raise ArchiveError(f"The ZIP would unpack to more than {MAX_TOTAL_BYTES // (1024 * 1024)} MB.")
        prefix = _strip_prefix([info.filename for info in infos])
        existing = set(existing_paths)
        planned: set[str] = set()
        entries: list[Entry] = []
        total = 0
        for info in infos:
            raw = info.filename
            if raw.endswith("/") or info.is_dir():
                continue  # folders exist only as the slashes in file paths
            if raw.startswith("/") or re.match(r"^[A-Za-z]:", raw) or "\\" in raw:
                entries.append(Entry(raw, "skipped", info.file_size, "Absolute paths and backslashes aren't allowed."))
                continue
            parts = raw.split("/")
            if any(part in JUNK_FOLDERS for part in parts[:-1]) or parts[-1] in JUNK_NAMES:
                entries.append(Entry(raw, "skipped", info.file_size, "System or build file."))
                continue
            if prefix and not raw.startswith(prefix):
                # In a NexusCode export: README.md and tasks.json aren't code
                entries.append(Entry(raw, "skipped", info.file_size, "Not part of the code (tasks aren't imported)."))
                continue
            path = raw[len(prefix):]
            if _is_symlink(info):
                entries.append(Entry(path, "skipped", info.file_size, "Symbolic links aren't allowed."))
                continue
            problem = path_problem(path) if path == posixpath.normpath(path) else "The path isn't in its simplest form (no '.', '..' or '//')."
            if problem:
                entries.append(Entry(path, "skipped", info.file_size, problem))
                continue
            if posixpath.splitext(path)[1].lower() in BINARY_EXTENSIONS:
                entries.append(Entry(path, "skipped", info.file_size, "Binary file (only text and code can be imported)."))
                continue
            if info.file_size > MAX_FILE_BYTES:
                entries.append(Entry(path, "skipped", info.file_size, f"Larger than {MAX_FILE_BYTES // 1000} KB."))
                continue
            if info.compress_size and info.file_size / info.compress_size > MAX_RATIO and info.file_size > 64 * 1024:
                entries.append(Entry(path, "skipped", info.file_size, "Compressed suspiciously well (a possible zip bomb)."))
                continue
            try:
                body = _read_limited(archive, info, MAX_FILE_BYTES)
            except (zipfile.BadZipFile, RuntimeError, NotImplementedError, OSError, EOFError):
                entries.append(Entry(path, "skipped", info.file_size, "Couldn't be read (damaged or encrypted)."))
                continue
            if body is None:
                entries.append(Entry(path, "skipped", info.file_size, f"Larger than {MAX_FILE_BYTES // 1000} KB."))
                continue
            total += len(body)
            if total > MAX_TOTAL_BYTES:
                raise ArchiveError(f"The ZIP unpacks to more than {MAX_TOTAL_BYTES // (1024 * 1024)} MB.")
            if b"\x00" in body:
                entries.append(Entry(path, "skipped", len(body), "Binary file (only text and code can be imported)."))
                continue
            try:
                content = body.decode("utf-8")
            except UnicodeDecodeError:
                entries.append(Entry(path, "skipped", len(body), "Not UTF-8 text."))
                continue
            if path in planned:
                entries.append(Entry(path, "skipped", len(body), "Appears twice in the ZIP."))
                continue
            if path in existing:
                entries.append(Entry(path, "duplicate", len(body), f"{path} already exists.", content))
                planned.add(path)
                continue
            clash = path_conflict(path, existing | planned)
            if clash:
                entries.append(Entry(path, "skipped", len(body), clash))
                continue
            entries.append(Entry(path, "new", len(body), None, content))
            planned.add(path)
    importable = sum(1 for e in entries if e.status in ("new", "duplicate"))
    if importable > capacity:
        raise ArchiveError(f"The ZIP has {importable} files to import, but this project has room for {capacity} more.")
    return entries


def plan(entries: list[Entry], existing_paths: list[str], decisions: dict[str, str]) -> list[tuple[str, str]]:
    """(path, content) pairs to create. Duplicates follow `decisions` (path -> "skip" | "rename"); the default is skip."""
    taken = set(existing_paths) | {e.path for e in entries if e.status == "new"}
    out = []
    for entry in entries:
        if entry.status == "new":
            out.append((entry.path, entry.content))
        elif entry.status == "duplicate" and decisions.get(entry.path) == "rename":
            target = free_name(entry.path, taken)
            taken.add(target)
            out.append((target, entry.content))
    return out


__all__ = [
    "ArchiveError", "Entry", "analyze", "build_export", "export_filename", "free_name", "language_for_path", "plan",
    "MAX_ARCHIVE_BYTES", "MAX_ENTRIES", "MAX_FILE_BYTES", "MAX_TOTAL_BYTES",
]
