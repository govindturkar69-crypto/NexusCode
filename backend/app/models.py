from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class TimestampMixin:
    """created_at / updated_at, filled by the database (see migration 0002)."""

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class UserModel(TimestampMixin, Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    github_token = Column(String, nullable=True)
    is_admin = Column(Boolean, default=False)

    projects = relationship("ProjectModel", back_populates="owner")

class ProjectModel(TimestampMixin, Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)

    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    owner = relationship("UserModel", back_populates="projects")
    tasks = relationship("TaskModel", back_populates="project", cascade="all, delete-orphan")
    files = relationship("FileModel", back_populates="project", cascade="all, delete-orphan")
    messages = relationship("MessageModel", back_populates="project", cascade="all, delete-orphan")
    code_file = relationship("CodeFileModel", back_populates="project", cascade="all, delete-orphan", uselist=False)

TASK_STATUSES = ("todo", "in_progress", "done")

class TaskModel(TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(
            "status IN (" + ", ".join(f"'{s}'" for s in TASK_STATUSES) + ")",
            name="ck_tasks_status",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    status = Column(String, nullable=False, default="todo", server_default="todo")
    # Order on the board; lower comes first
    position = Column(Integer, nullable=False, default=0, server_default="0")

    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    project = relationship("ProjectModel", back_populates="tasks")

class FileModel(TimestampMixin, Base):
    __tablename__ = "files"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    url = Column(String, nullable=False)
    # Cloudinary public_id, needed to delete the upload. NULL for files
    # uploaded before migration 0002.
    public_id = Column(String, nullable=True)
    # Needed with public_id to delete from Cloudinary (migration 0003)
    resource_type = Column(String, nullable=True)
    content_type = Column(String, nullable=True)
    size_bytes = Column(Integer, nullable=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)

    project = relationship("ProjectModel", back_populates="files")

class MessageModel(TimestampMixin, Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    content = Column(String, nullable=False)
    # Display name at the time of sending; kept for messages older than user_id
    username = Column(String, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL", name="fk_messages_user_id_users"), nullable=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)

    project = relationship("ProjectModel", back_populates="messages")
    user = relationship("UserModel")

class CodeFileModel(TimestampMixin, Base):
    __tablename__ = "code_files"

    id = Column(Integer, primary_key=True, index=True)
    content = Column(String, default="")
    language = Column(String, default="python")
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, unique=True)

    project = relationship("ProjectModel", back_populates="code_file")
