from etl.orchestrator import Job, JobRegistry


def build_default_registry() -> JobRegistry:
    registry = JobRegistry()

    # --- Tier 1: External data loads (no dependencies) ---
    registry.register(Job(
        name="crashes_switrs",
        module="etl.load_crashes",
        args=["--start", "2001", "--end", "2015", "--source", "switrs"],
        schedule="static",
        table_name="crashes",
        max_drop_pct=1,
    ))
    registry.register(Job(
        name="crashes_ccrs",
        module="etl.load_crashes",
        args=["--start", "2016", "--end", "2026", "--source", "ccrs"],
        schedule="daily",
        table_name="crashes",
        max_drop_pct=5,
    ))
    registry.register(Job(
        name="parties",
        module="etl.load_parties_victims",
        args=["--table", "parties"],
        depends_on=["crashes_ccrs"],
        schedule="daily",
        table_name="crash_parties",
        max_drop_pct=5,
    ))
    registry.register(Job(
        name="victims",
        module="etl.load_parties_victims",
        args=["--table", "victims"],
        depends_on=["crashes_ccrs"],
        schedule="daily",
        table_name="crash_victims",
        max_drop_pct=5,
    ))
    registry.register(Job(
        name="demographics",
        module="etl.load_demographics",
        schedule="monthly",
        table_name="demographics",
        max_drop_pct=10,
    ))
    registry.register(Job(
        name="weather",
        module="etl.noaa_weather",
        schedule="monthly",
        table_name="county_weather",
        max_drop_pct=5,
    ))
    registry.register(Job(
        name="hospitals",
        module="etl.load_hospitals",
        schedule="monthly",
        table_name="hospitals",
        max_drop_pct=20,
    ))
    registry.register(Job(
        name="schools",
        module="etl.load_schools",
        schedule="monthly",
        table_name="schools",
        max_drop_pct=20,
    ))
    registry.register(Job(
        name="speed_limits",
        module="etl.load_speed_limits",
        schedule="monthly",
        table_name="speed_limits",
        max_drop_pct=20,
    ))
    registry.register(Job(
        name="aadt",
        module="etl.caltrans_aadt",
        schedule="monthly",
        table_name="caltrans_aadt",
        max_drop_pct=20,
    ))
    registry.register(Job(
        name="vehicles",
        module="etl.dmv_vehicles",
        schedule="monthly",
        table_name="dmv_vehicles",
        max_drop_pct=10,
    ))
    registry.register(Job(
        name="unemployment",
        module="etl.bls_unemployment",
        schedule="monthly",
        table_name="bls_unemployment",
        max_drop_pct=10,
    ))
    registry.register(Job(
        name="calenviroscreen",
        module="etl.load_calenviroscreen",
        schedule="monthly",
        table_name="calenviroscreen",
        max_drop_pct=20,
    ))
    registry.register(Job(
        name="licensed_drivers",
        module="etl.load_licensed_drivers",
        schedule="monthly",
        table_name="licensed_drivers",
        max_drop_pct=10,
    ))
    registry.register(Job(
        name="road_miles",
        module="etl.load_road_miles",
        schedule="monthly",
        table_name="road_miles",
        max_drop_pct=20,
    ))

    # --- Tier 2: Internal transforms (depend on external loads) ---
    registry.register(Job(
        name="backfill",
        module="etl.backfill_derived",
        depends_on=["crashes_ccrs", "parties", "victims"],
        schedule="daily",
    ))
    registry.register(Job(
        name="data_quality",
        module="etl.compute_data_quality",
        depends_on=["backfill"],
        schedule="daily",
    ))
    registry.register(Job(
        name="validate_coords",
        module="etl.validate_coords",
        depends_on=["crashes_ccrs"],
        schedule="daily",
    ))
    registry.register(Job(
        name="matviews",
        module="etl.refresh_materialized_views",
        depends_on=["backfill", "data_quality"],
        schedule="daily",
    ))
    registry.register(Job(
        name="insights",
        module="etl.generate_insights",
        depends_on=["matviews"],
        schedule="daily",
    ))
    registry.register(Job(
        name="vacuum",
        module="etl.vacuum_analyze",
        depends_on=["matviews", "insights"],
        schedule="daily",
    ))

    return registry
