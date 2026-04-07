"""Tests for SQLAlchemy models.

These tests verify model definitions are correct by inspecting
the table metadata — no database connection needed.
"""

from sqlalchemy import String

from app.models import County, Crash, Demographic, CountyInsight, CountyInsightDetail, EtlRun


class TestCountyModel:
    def test_table_name(self):
        assert County.__tablename__ == "counties"

    def test_has_population_column(self):
        columns = {c.name for c in County.__table__.columns}
        assert "population" in columns

    def test_has_geojson_column(self):
        columns = {c.name for c in County.__table__.columns}
        assert "geojson" in columns

    def test_population_is_nullable(self):
        """Population can be null until Census data is loaded."""
        col = County.__table__.c.population
        assert col.nullable is True


class TestCrashModel:
    def test_table_name(self):
        assert Crash.__tablename__ == "crashes"

    def test_county_code_has_foreign_key(self):
        col = Crash.__table__.c.county_code
        fk_targets = {fk.target_fullname for fk in col.foreign_keys}
        assert "counties.code" in fk_targets

    def test_has_created_at_column(self):
        columns = {c.name for c in Crash.__table__.columns}
        assert "created_at" in columns

    def test_created_at_has_server_default(self):
        col = Crash.__table__.c.created_at
        assert col.server_default is not None

    def test_hit_run_is_string(self):
        """hit_run stores CCRS codes: null=no, M=misdemeanor, F=felony."""
        col = Crash.__table__.c.hit_run
        assert isinstance(col.type, String)
        assert col.type.length == 1

    def test_hit_run_is_nullable(self):
        """null means no hit-and-run."""
        col = Crash.__table__.c.hit_run
        assert col.nullable is True


class TestDemographicModel:
    def test_table_name(self):
        assert Demographic.__tablename__ == "demographics"

    def test_county_code_has_foreign_key(self):
        col = Demographic.__table__.c.county_code
        fk_targets = {fk.target_fullname for fk in col.foreign_keys}
        assert "counties.code" in fk_targets

    def test_unique_constraint_county_year(self):
        """Only one row per county per year."""
        constraints = Demographic.__table__.constraints
        unique_cols = None
        for c in constraints:
            if hasattr(c, "columns") and len(c.columns) == 2:
                cols = {col.name for col in c.columns}
                if cols == {"county_code", "year"}:
                    unique_cols = cols
        assert unique_cols == {"county_code", "year"}

    def test_has_commute_columns(self):
        columns = {c.name for c in Demographic.__table__.columns}
        expected = {
            "commute_drive_alone_pct",
            "commute_carpool_pct",
            "commute_transit_pct",
            "commute_walk_pct",
            "commute_bike_pct",
            "commute_wfh_pct",
        }
        assert expected.issubset(columns)


class TestCountyInsightModel:
    def test_table_name(self):
        assert CountyInsight.__tablename__ == "county_insights"

    def test_county_code_has_foreign_key(self):
        col = CountyInsight.__table__.c.county_code
        fk_targets = {fk.target_fullname for fk in col.foreign_keys}
        assert "counties.code" in fk_targets

    def test_has_narrative_column(self):
        columns = {c.name for c in CountyInsight.__table__.columns}
        assert "narrative" in columns

    def test_unique_constraint_county_year(self):
        constraints = CountyInsight.__table__.constraints
        unique_cols = None
        for c in constraints:
            if hasattr(c, "columns") and len(c.columns) == 2:
                cols = {col.name for col in c.columns}
                if cols == {"county_code", "year"}:
                    unique_cols = cols
        assert unique_cols == {"county_code", "year"}


class TestCountyInsightDetailModel:
    def test_table_name(self):
        assert CountyInsightDetail.__tablename__ == "county_insight_details"

    def test_county_code_has_foreign_key(self):
        col = CountyInsightDetail.__table__.c.county_code
        fk_targets = {fk.target_fullname for fk in col.foreign_keys}
        assert "counties.code" in fk_targets

    def test_unique_constraint(self):
        """Only one row per county/year/category/label."""
        constraints = CountyInsightDetail.__table__.constraints
        unique_cols = None
        for c in constraints:
            if hasattr(c, "columns") and len(c.columns) == 4:
                cols = {col.name for col in c.columns}
                if cols == {"county_code", "year", "category", "label"}:
                    unique_cols = cols
        assert unique_cols == {"county_code", "year", "category", "label"}


class TestEtlRunModel:
    def test_table_name(self):
        assert EtlRun.__tablename__ == "etl_runs"

    def test_has_no_foreign_keys(self):
        """ETL runs are standalone — no FK to counties."""
        for col in EtlRun.__table__.columns:
            assert len(col.foreign_keys) == 0

    def test_has_source_column(self):
        columns = {c.name for c in EtlRun.__table__.columns}
        assert "source" in columns

    def test_has_error_message_column(self):
        columns = {c.name for c in EtlRun.__table__.columns}
        assert "error_message" in columns

    def test_source_started_at_index(self):
        indexes = {idx.name for idx in EtlRun.__table__.indexes}
        assert "ix_etl_runs_source_started_at" in indexes
