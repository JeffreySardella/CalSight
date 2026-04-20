"""Shared Pydantic models: error envelope, pagination wrapper."""

from typing import Generic, TypeVar

from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    detail: str
    filter: str | None = Field(
        default=None,
        description="Which filter param was invalid, if any.",
    )


T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    limit: int
    offset: int
    items: list[T]
    total: int | None = None
