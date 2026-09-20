"""Response models for /api/crashes/heatmap."""

from pydantic import BaseModel, model_serializer


class HeatmapPoint(BaseModel):
    lat: float
    lng: float
    weight: int
    severity: str | None = None
    collision_id: int | None = None
    data_source: str | None = None
    crash_datetime: str | None = None
    canonical_cause: str | None = None
    weather: str | None = None
    lighting: str | None = None
    number_killed: int | None = None
    number_injured: int | None = None
    primary_road: str | None = None
    hit_run: str | None = None

    @model_serializer(mode="wrap")
    def _drop_empty_fields(self, handler):
        """Serialize only the fields that carry a value.

        A grid or slim point is just lat/lng/weight, but every point used to
        ship the ten detail fields as explicit nulls: about 200 bytes of noise
        per point. Gzip hid it on the wire, but the client still had to parse
        it — 5 MB of JSON for a 20,000-cell layer that needs 0.8 MB. The
        frontend types every detail field as optional, so an absent key reads
        the same as a null one.
        """
        return {k: v for k, v in handler(self).items() if v is not None}


class HeatmapResponse(BaseModel):
    points: list[HeatmapPoint]
    total_crashes: int
    batch: int | None = None
    total_batches: int | None = None
    grid_step: float | None = None
