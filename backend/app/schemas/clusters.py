"""Response models for /api/crashes/clusters."""

from pydantic import BaseModel


class SeverityBreakdown(BaseModel):
    fatal: int
    injury: int
    pdo: int


class ClusterPoint(BaseModel):
    lat: float
    lng: float
    crash_count: int
    z_score: float
    severity: SeverityBreakdown


class ClusterResponse(BaseModel):
    clusters: list[ClusterPoint]
    total_grid_cells: int
    mean_count: float
    stddev_count: float
    threshold: float
