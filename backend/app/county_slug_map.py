"""Slug <-> county_code lookup built from the counties table.

The slug convention matches `frontend/src/hooks/useFilterParams.ts`:
lowercase, spaces replaced with hyphens. Examples: Los Angeles -> los-angeles.

Usage inside a handler:
    slug_map = get_slug_map(db)  # lazy-built + cached per process
    code = get_code("los-angeles", slug_map)
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import County


def slugify_name(name: str) -> str:
    """CA county name -> URL slug. Matches frontend slugify()."""
    return name.lower().replace(" ", "-")


def build_map(rows: list[tuple[int, str]]) -> dict[str, int]:
    """Build {slug: code} from (code, name) tuples."""
    return {slugify_name(name): code for code, name in rows}


def get_code(slug: str, slug_map: dict[str, int]) -> int | None:
    return slug_map.get(slug)


_cached_map: dict[str, int] | None = None


def get_slug_map(db: Session) -> dict[str, int]:
    """Return {slug: code} for all 58 counties, built once per process."""
    global _cached_map
    if _cached_map is None:
        rows = [(c.code, c.name) for c in db.query(County.code, County.name).all()]
        _cached_map = build_map(rows)
    return _cached_map


def _reset_cache_for_tests() -> None:
    """Test helper — let each session start with a fresh cache."""
    global _cached_map
    _cached_map = None
