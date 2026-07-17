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
        # No --end: the module default (current year + 1) auto-advances,
        # so new calendar years don't need a manual edit here.
        args=["--start", "2016", "--source", "ccrs"],
        schedule="daily",
        table_name="crashes",
        max_drop_pct=5,
        source_type="ckan",
        freshness_resource_id="b8ce0ca4-b4e9-490d-b4d1-1f4ec48cbefb",
        freshness_ckan_prefix="Crashes",
    ))
    registry.register(Job(
        name="parties",
        module="etl.load_parties_victims",
        args=["--table", "parties"],
        depends_on=["crashes_ccrs"],
        schedule="daily",
        table_name="crash_parties",
        max_drop_pct=5,
        timeout=21600,
        source_type="ckan",
        freshness_resource_id="348a4266-bbb6-439f-b6c7-0018cc79f0fe",
        freshness_ckan_prefix="Parties",
    ))
    registry.register(Job(
        name="victims",
        module="etl.load_parties_victims",
        args=["--table", "victims"],
        depends_on=["crashes_ccrs"],
        schedule="daily",
        table_name="crash_victims",
        max_drop_pct=5,
        timeout=14400,
        source_type="ckan",
        freshness_resource_id="bbe0c38e-d0eb-4152-86e2-0b0895e66ba9",
        freshness_ckan_prefix="InjuredWitnessPassengers",
    ))
    registry.register(Job(
        name="demographics",
        module="etl.load_demographics",
        schedule="monthly",
        table_name="demographics",
        max_drop_pct=10,
        source_type="federal",
        freshness_table="demographics",
    ))
    registry.register(Job(
        name="weather",
        module="etl.noaa_weather",
        schedule="monthly",
        table_name="weather",
        max_drop_pct=5,
        source_type="federal",
        freshness_table="weather",
    ))
    registry.register(Job(
        name="fars",
        module="etl.nhtsa_fars",
        schedule="monthly",
        table_name="fars_county_year",
        max_drop_pct=10,
        source_type="federal",
        freshness_table="fars_county_year",
    ))
    registry.register(Job(
        name="tract_density",
        module="etl.census_tract_density",
        schedule="monthly",
        table_name="tract_density_county_year",
        max_drop_pct=10,
        source_type="federal",
        freshness_table="tract_density_county_year",
    ))
    registry.register(Job(
        name="hospitals",
        module="etl.load_hospitals",
        schedule="monthly",
        table_name="hospitals",
        max_drop_pct=20,
        source_type="ckan",
        freshness_resource_id="3d2503d7-56ad-4f38-8435-3d86d27b7407",
    ))
    registry.register(Job(
        name="schools",
        module="etl.load_schools",
        schedule="monthly",
        table_name="school_locations",
        max_drop_pct=20,
        source_type="ckan",
        freshness_resource_id="23740f30-e860-4ada-a7cb-8de6d21e2c78",
    ))
    registry.register(Job(
        name="speed_limits",
        module="etl.load_speed_limits",
        schedule="monthly",
        table_name="speed_limits",
        max_drop_pct=20,
        source_type="arcgis",
        freshness_url="https://geo.dot.gov/server/rest/services/Hosted/HPMS_Full_CA_2022/FeatureServer/0/query",
    ))
    registry.register(Job(
        name="aadt",
        module="etl.caltrans_aadt",
        schedule="monthly",
        table_name="traffic_volumes",
        max_drop_pct=20,
        source_type="arcgis",
        freshness_url="https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Traffic_AADT/FeatureServer/0/query",
    ))
    registry.register(Job(
        name="vehicles",
        module="etl.dmv_vehicles",
        schedule="monthly",
        table_name="vehicle_registrations",
        max_drop_pct=10,
        source_type="ckan",
        freshness_resource_id="b459d957-5d94-4b10-999d-770419870364",
    ))
    registry.register(Job(
        name="unemployment",
        module="etl.bls_unemployment",
        schedule="monthly",
        table_name="unemployment_rates",
        max_drop_pct=10,
        source_type="federal",
        freshness_table="unemployment_rates",
    ))
    registry.register(Job(
        name="calenviroscreen",
        module="etl.load_calenviroscreen",
        schedule="monthly",
        table_name="calenviroscreen",
        max_drop_pct=20,
        source_type="arcgis",
        freshness_url="https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services/calenviroscreen50results_F_070126_gdb/FeatureServer/0/query",
    ))
    registry.register(Job(
        name="licensed_drivers",
        module="etl.load_licensed_drivers",
        schedule="monthly",
        table_name="licensed_drivers",
        max_drop_pct=10,
        source_type="ckan",
        freshness_resource_id="0abef7f0-285f-4887-9b4e-69e86d89ceb1",
    ))
    registry.register(Job(
        name="road_miles",
        module="etl.load_road_miles",
        schedule="monthly",
        table_name="road_miles",
        max_drop_pct=20,
        source_type="ckan",
        freshness_resource_id="5180390d-e323-4751-8ce9-939e62918233",
    ))

    # --- Tier 2: Internal transforms (depend on external loads) ---
    registry.register(Job(
        name="backfill",
        module="etl.backfill_derived",
        depends_on=["crashes_ccrs", "parties"],
        schedule="daily",
    ))
    registry.register(Job(
        name="backfill_conditions",
        module="etl.backfill_conditions",
        depends_on=["backfill"],
        schedule="daily",
    ))
    registry.register(Job(
        name="data_quality",
        module="etl.compute_data_quality",
        depends_on=["backfill", "backfill_conditions"],
        schedule="daily",
    ))
    registry.register(Job(
        name="validate_coords",
        module="etl.validate_coords",
        depends_on=["crashes_ccrs"],
        schedule="daily",
    ))
    registry.register(Job(
        name="route_number",
        module="etl.extract_route_number",
        depends_on=["crashes_ccrs"],
        schedule="daily",
        # First run backfills route_number across all ~11M crashes; the regex
        # extraction + chunked UPDATEs run long, so allow 2h. Idempotent (only
        # touches NULL rows), so later daily runs only handle newly loaded crashes.
        timeout=7200,
    ))
    registry.register(Job(
        name="matviews",
        module="etl.refresh_materialized_views",
        # "victims" matters: mv_crash_victims_by_demographics is refreshed
        # here, and without the dep the alphabetical topo order ran matviews
        # BEFORE victims — the victims matview was always a day stale.
        depends_on=["backfill", "data_quality", "demographics", "licensed_drivers", "vehicles", "road_miles", "aadt", "victims"],
        schedule="daily",
    ))
    registry.register(Job(
        name="reservoirs",
        module="etl.load_reservoirs",
        schedule="daily",
        table_name="reservoir_daily",
        # Upserts never delete; a shrink means CDEC data vanished — fail loudly.
        max_drop_pct=1,
        # CDEC has no freshness probe endpoint; the trailing-window fetch is
        # cheap enough to just run daily.
        source_type="none",
    ))
    registry.register(Job(
        name="snowpack",
        module="etl.load_snowpack",
        # SWE is daily; the trailing-window pull is cheap. Like reservoirs,
        # CDEC has no freshness probe, so just run it on the daily cadence.
        schedule="daily",
        table_name="snow_daily",
        # Upserts never delete; a shrink means CDEC data vanished — fail loudly.
        max_drop_pct=1,
        source_type="none",
    ))
    registry.register(Job(
        name="precip_indices",
        module="etl.load_precip_indices",
        # Accumulated water-year precip for the 8SI/5SI/6SI indices; daily
        # trailing-window pull. Like the other CDEC jobs, no freshness probe.
        schedule="daily",
        table_name="precip_index_daily",
        # Upserts never delete; a shrink means CDEC data vanished — fail loudly.
        max_drop_pct=1,
        source_type="none",
    ))
    registry.register(Job(
        name="drought",
        module="etl.load_drought",
        # The pipeline runs every non-static job on its daily cadence
        # (schedule strings other than "static" are informational). USDM
        # only publishes weekly, but the trailing 8-week pull is one tiny
        # request, so a daily re-pull is cheap and absorbs their revisions.
        schedule="daily",
        table_name="drought_county_weekly",
        # Upserts never delete; a shrink means USDM data vanished — fail loudly.
        max_drop_pct=1,
        source_type="none",
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
