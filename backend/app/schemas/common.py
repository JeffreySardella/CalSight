"""Shared Pydantic models: pagination wrapper."""

from typing import Generic, TypeVar

from pydantic import BaseModel


T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    limit: int
    offset: int
    items: list[T]
    total: int | None = None
