from sqlalchemy import Column, Integer, String, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from database import Base

class TodoModel(Base):
    __tablename__ = "todos"

    id = Column(Integer, primary_key=True, index=True)
    task = Column(String, nullable=False)
    done = Column(Boolean, default=False)

class UserModel(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    github_token = Column(String, nullable=True)

    projects = relationship("ProjectModel", back_populates="owner")

class ProjectModel(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)

    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    owner = relationship("UserModel", back_populates="projects")
    tasks = relationship("TaskModel", back_populates="project", cascade="all, delete-orphan")
    files = relationship("FileModel", back_populates="project", cascade="all, delete-orphan")
    messages = relationship("MessageModel", back_populates="project", cascade="all, delete-orphan")
    code_file = relationship("CodeFileModel", back_populates="project", cascade="all, delete-orphan", uselist=False)

class TaskModel(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    status = Column(String, default="todo")

    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    project = relationship("ProjectModel", back_populates="tasks")

class FileModel(Base):
    __tablename__ = "files"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    url = Column(String, nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)

    project = relationship("ProjectModel", back_populates="files")

class MessageModel(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    content = Column(String, nullable=False)
    username = Column(String, nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)

    project = relationship("ProjectModel", back_populates="messages")

class CodeFileModel(Base):
    __tablename__ = "code_files"

    id = Column(Integer, primary_key=True, index=True)
    content = Column(String, default="")
    language = Column(String, default="python")
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, unique=True)

    project = relationship("ProjectModel", back_populates="code_file")