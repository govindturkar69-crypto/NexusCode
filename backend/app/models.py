from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.orm import relationship
from sqlalchemy.types import TypeDecorator

from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.database import Base


class EncryptedString(TypeDecorator):
    """A string column that is Fernet-encrypted at rest (see app/core/crypto.py).
    Python code reads and writes plaintext; the database only sees ciphertext."""

    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return None if value is None else encrypt_secret(value)

    def process_result_value(self, value, dialect):
        return None if value is None else decrypt_secret(value)


class TimestampMixin:
    """created_at / updated_at, filled by the database (see migration 0002)."""

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class UserModel(TimestampMixin, Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    # Encrypted at rest; existing plaintext rows are encrypted by migration 0004
    github_token = Column(EncryptedString, nullable=True)
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
    code_files = relationship("CodeFileModel", back_populates="project", cascade="all, delete-orphan")
    members = relationship("ProjectMemberModel", back_populates="project", cascade="all, delete-orphan")
    activity = relationship("ActivityModel", cascade="all, delete-orphan")
    notifications = relationship("NotificationModel", cascade="all, delete-orphan")

# Lowest to highest; each role can do everything the ones before it can
PROJECT_ROLES = ("viewer", "editor", "owner")

class ProjectMemberModel(Base):
    """Who can access a project. This table, not projects.owner_id, decides access."""

    __tablename__ = "project_members"
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_members_project_user"),
        CheckConstraint("role IN ('owner', 'editor', 'viewer')", name="ck_project_members_role"),
    )

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    project = relationship("ProjectModel", back_populates="members")
    user = relationship("UserModel")

class ActivityModel(Base):
    """What happened in a project, for the Activity panel. Target is plain text
    (a task title, a filename) so entries survive the thing they describe."""

    __tablename__ = "activity"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action = Column(String, nullable=False)
    target = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

class NotificationModel(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint("kind IN ('assigned', 'added', 'role_changed')", name="ck_notifications_kind"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String, nullable=False)
    message = Column(String, nullable=False)
    is_read = Column(Boolean, nullable=False, default=False, server_default=false())
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

TASK_STATUSES = ("todo", "in_progress", "done")
TASK_PRIORITIES = ("low", "medium", "high")

class TaskModel(TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(
            "status IN (" + ", ".join(f"'{s}'" for s in TASK_STATUSES) + ")",
            name="ck_tasks_status",
        ),
        CheckConstraint("priority IN ('low', 'medium', 'high')", name="ck_tasks_priority"),
    )

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    status = Column(String, nullable=False, default="todo", server_default="todo")
    # Order on the board; lower comes first
    position = Column(Integer, nullable=False, default=0, server_default="0")
    assignee_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL", name="fk_tasks_assignee_id_users"), nullable=True, index=True)
    due_date = Column(Date, nullable=True)
    priority = Column(String, nullable=False, default="medium", server_default="medium")

    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    project = relationship("ProjectModel", back_populates="tasks")
    assignee = relationship("UserModel")

    @property
    def assignee_username(self):
        return self.assignee.username if self.assignee else None

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
    __table_args__ = (UniqueConstraint("project_id", "path", name="uq_code_files_project_path"),)

    id = Column(Integer, primary_key=True, index=True)
    # Folders exist only as slashes in this path; see services/code_paths.py
    path = Column(String, nullable=False)
    content = Column(String, default="")
    language = Column(String, default="plaintext")
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)

    project = relationship("ProjectModel", back_populates="code_files")
