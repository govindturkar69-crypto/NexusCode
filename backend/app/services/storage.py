"""
Cloudinary storage plus upload validation.

Every upload gets its own public_id (projects/<project_id>/<uuid>), so files
can't overwrite each other, and the id + resource_type are stored so the
asset can be deleted later.
"""
import logging
import uuid
from dataclasses import dataclass

import cloudinary
import cloudinary.uploader

from app.core.config import settings

logger = logging.getLogger("nexuscode")

cloudinary.config(
    cloud_name=settings.cloudinary_cloud_name,
    api_key=settings.cloudinary_api_key,
    api_secret=settings.cloudinary_api_secret,
)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

# content type -> (allowed extensions, Cloudinary resource_type, magic-byte check)
# SVG and HTML are deliberately absent: both can carry scripts.
_IMAGE = "image"
_RAW = "raw"
ALLOWED_TYPES = {
    "image/png": ({"png"}, _IMAGE, lambda b: b.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/jpeg": ({"jpg", "jpeg"}, _IMAGE, lambda b: b.startswith(b"\xff\xd8\xff")),
    "image/gif": ({"gif"}, _IMAGE, lambda b: b[:6] in (b"GIF87a", b"GIF89a")),
    "image/webp": ({"webp"}, _IMAGE, lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP"),
    "application/pdf": ({"pdf"}, _IMAGE, lambda b: b.startswith(b"%PDF-")),
    "application/zip": ({"zip"}, _RAW, lambda b: b[:4] in (b"PK\x03\x04", b"PK\x05\x06")),
    "text/plain": ({"txt", "log", "py", "js", "jsx", "ts", "tsx", "java", "c", "cpp", "h", "css", "sql", "yml", "yaml", "toml", "ini"}, _RAW, None),
    "text/markdown": ({"md", "markdown"}, _RAW, None),
    "text/csv": ({"csv"}, _RAW, None),
    "application/json": ({"json"}, _RAW, None),
}
TEXT_TYPES = {t for t, (_, _, check) in ALLOWED_TYPES.items() if check is None}


class UploadRejected(Exception):
    """The file is not acceptable; the message is safe to show to the user."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class StoredFile:
    url: str
    public_id: str
    resource_type: str
    content_type: str
    size_bytes: int


def _extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def validate_upload(filename: str, content_type: str | None, data: bytes) -> tuple[str, str]:
    """Returns (content_type, resource_type) or raises UploadRejected."""
    if not data:
        raise UploadRejected("The file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise UploadRejected("Files can be at most 10 MB.", status_code=413)

    content_type = (content_type or "").split(";")[0].strip().lower()
    # Browsers often send code files as application/octet-stream or text/x-*
    if content_type not in ALLOWED_TYPES and (content_type.startswith("text/") or content_type in ("", "application/octet-stream")):
        content_type = next((t for t in TEXT_TYPES if _extension(filename) in ALLOWED_TYPES[t][0]), content_type)
    if content_type not in ALLOWED_TYPES:
        raise UploadRejected("This file type isn't allowed. Upload images, PDFs, ZIPs, or text/code files.", status_code=415)

    extensions, resource_type, looks_right = ALLOWED_TYPES[content_type]
    if _extension(filename) not in extensions:
        raise UploadRejected(f"The file extension doesn't match its type ({content_type}).", status_code=415)
    if looks_right is not None and not looks_right(data):
        raise UploadRejected("The file's contents don't match its type.", status_code=415)
    if content_type in TEXT_TYPES:
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            raise UploadRejected("Text files must be UTF-8.", status_code=415) from None
    return content_type, resource_type


def upload_project_file(project_id: int, filename: str, content_type: str | None, data: bytes) -> StoredFile:
    content_type, resource_type = validate_upload(filename, content_type, data)
    public_id = f"projects/{project_id}/{uuid.uuid4().hex}"
    if resource_type == _RAW:
        # Raw assets are served as-is; keep the extension so downloads open correctly
        public_id += f".{_extension(filename)}"
    result = cloudinary.uploader.upload(
        data,
        public_id=public_id,
        resource_type=resource_type,
        overwrite=False,
        unique_filename=False,
        use_filename=False,
    )
    return StoredFile(
        url=result["secure_url"],
        public_id=result.get("public_id", public_id),
        resource_type=result.get("resource_type", resource_type),
        content_type=content_type,
        size_bytes=len(data),
    )


def delete_project_file(public_id: str, resource_type: str | None) -> None:
    """Deletes the asset. 'not found' counts as success (already gone).
    Raises on any other Cloudinary failure so the caller can keep the row."""
    result = cloudinary.uploader.destroy(public_id, resource_type=resource_type or _IMAGE, invalidate=True)
    outcome = result.get("result")
    if outcome not in ("ok", "not found"):
        raise RuntimeError(f"Cloudinary delete failed for {public_id}: {outcome}")
