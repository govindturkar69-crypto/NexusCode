from pydantic import BaseModel, ConfigDict


class ORMModel(BaseModel):
    """Base for response models built from SQLAlchemy objects."""

    model_config = ConfigDict(from_attributes=True)


class MessageResponse(BaseModel):
    message: str


class Page(BaseModel):
    """Fields added to every paginated list response."""

    total: int
    limit: int
    offset: int
