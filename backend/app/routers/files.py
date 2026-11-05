import logging

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Pagination, require_project_role
from app.models import FileModel, ProjectModel
from app.schemas.project import FileListResponse, FileResponse
from app.services import storage

logger = logging.getLogger("nexuscode")

router = APIRouter(tags=["files"])


# A plain `def` (not async): FastAPI runs it in a worker thread, so the
# file read and the Cloudinary upload don't block the event loop.
@router.post("/projects/{project_id}/files", status_code=201, response_model=FileResponse)
def upload_file(file: UploadFile = File(...), project: ProjectModel = Depends(require_project_role("editor")), db: Session = Depends(get_db)):
    # Read one byte past the limit so oversized files are detected without
    # loading arbitrarily large bodies (the middleware already checked
    # Content-Length; this is the definitive check).
    data = file.file.read(storage.MAX_UPLOAD_BYTES + 1)
    filename = file.filename or "upload"
    try:
        stored = storage.upload_project_file(project.id, filename, file.content_type, data)
    except storage.UploadRejected as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    except Exception as e:
        logger.exception("Cloudinary upload failed (project %s)", project.id)
        raise HTTPException(status_code=502, detail="File storage is unavailable. Please try again.") from e

    new_file = FileModel(
        filename=filename,
        url=stored.url,
        public_id=stored.public_id,
        resource_type=stored.resource_type,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
        project_id=project.id,
    )
    db.add(new_file)
    db.commit()
    db.refresh(new_file)
    return {"message": "File uploaded", "file": new_file}


@router.get("/projects/{project_id}/files", response_model=FileListResponse)
def get_project_files(page: Pagination = Depends(), project: ProjectModel = Depends(require_project_role("viewer")), db: Session = Depends(get_db)):
    query = db.query(FileModel).filter(FileModel.project_id == project.id).order_by(FileModel.id)
    return page.envelope("files", *page.apply(query))


@router.delete("/files/{file_id}", status_code=204)
def delete_file(file: FileModel = Depends(require_project_role("editor", "file")), db: Session = Depends(get_db)):
    if file.public_id:
        try:
            storage.delete_project_file(file.public_id, file.resource_type)
        except Exception as e:
            # Keep the row so the user can retry; otherwise the asset would be orphaned
            logger.exception("Cloudinary delete failed for file %s", file.id)
            raise HTTPException(status_code=502, detail="Couldn't delete the file from storage. Please try again.") from e
    else:
        # Uploaded before public_id was recorded: nothing reliable to delete remotely
        logger.warning("File %s has no public_id; removed from the database only", file.id)
    db.delete(file)
    db.commit()
    return Response(status_code=204)


def delete_project_assets(project: ProjectModel) -> None:
    """Best effort cleanup when a whole project is deleted."""
    for file in project.files:
        if not file.public_id:
            continue
        try:
            storage.delete_project_file(file.public_id, file.resource_type)
        except Exception:
            logger.exception("Couldn't delete Cloudinary asset %s while deleting project %s", file.public_id, project.id)
