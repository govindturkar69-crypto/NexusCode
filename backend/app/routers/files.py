from fastapi import APIRouter, Depends, File, Response, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_owned_file, get_owned_project
from app.models import FileModel, ProjectModel
from app.schemas.project import FileListResponse, FileResponse
from app.services import storage

router = APIRouter(tags=["files"])


@router.post("/projects/{project_id}/files", status_code=201, response_model=FileResponse)
async def upload_file(file: UploadFile = File(...), project: ProjectModel = Depends(get_owned_project), db: Session = Depends(get_db)):
    file_bytes = await file.read()
    url = storage.upload_file_to_cloudinary(file_bytes, file.filename)

    new_file = FileModel(filename=file.filename, url=url, project_id=project.id)
    db.add(new_file)
    db.commit()
    db.refresh(new_file)
    return {"message": "File uploaded", "file": new_file}


@router.get("/projects/{project_id}/files", response_model=FileListResponse)
def get_project_files(project: ProjectModel = Depends(get_owned_project), db: Session = Depends(get_db)):
    files = db.query(FileModel).filter(FileModel.project_id == project.id).order_by(FileModel.id).all()
    return {"files": files}


@router.delete("/files/{file_id}", status_code=204)
def delete_file(file: FileModel = Depends(get_owned_file), db: Session = Depends(get_db)):
    db.delete(file)
    db.commit()
    return Response(status_code=204)
