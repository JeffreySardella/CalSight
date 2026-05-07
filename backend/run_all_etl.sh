#!/bin/bash
# Run all ETL jobs sequentially.
# Each job is idempotent — safe to re-run without duplicates.
#
# Usage:
#   cd backend && bash run_all_etl.sh
#
# Prerequisites:
#   - Postgres running (docker compose up db)
#   - .env file with DATABASE_URL, CENSUS_API_KEY, NOAA_API_TOKEN, BLS_API_KEY

set -e  # Stop on first error

echo "============================================"
echo "  CalSight ETL Pipeline — Full Run"
echo "============================================"

echo ""
echo "=== 1/20  SWITRS crash data (2001-2015) ==="
python -m etl.load_crashes --start 2001 --end 2015 --source switrs
echo "=== SWITRS done ==="

echo ""
echo "=== 2/20CCRS crash data (2016-2026) ==="
python -m etl.load_crashes --start 2016 --end 2026 --source ccrs
echo "=== CCRS done ==="

echo ""
echo "=== 3/20CCRS parties & victims ==="
python -m etl.load_parties_victims
echo "=== Parties & victims done ==="

echo ""
echo "=== 4/20Census demographics (2005-2022) ==="
python -m etl.load_demographics
echo "=== Demographics done ==="

echo ""
echo "=== 5/20NOAA weather (2001-2025) ==="
python -m etl.noaa_weather
echo "=== Weather done ==="

echo ""
echo "=== 6/20Hospitals & trauma centers ==="
python -m etl.load_hospitals
echo "=== Hospitals done ==="

echo ""
echo "=== 7/20School locations ==="
python -m etl.load_schools
echo "=== Schools done ==="

echo ""
echo "=== 8/20Speed limits (FHWA HPMS) ==="
python -m etl.load_speed_limits
echo "=== Speed limits done ==="

echo ""
echo "=== 9/20Traffic volumes (Caltrans AADT) ==="
python -m etl.caltrans_aadt
echo "=== Traffic volumes done ==="

echo ""
echo "=== 10/20Vehicle registrations (DMV) ==="
python -m etl.dmv_vehicles
echo "=== Vehicle registrations done ==="

echo ""
echo "=== 11/20BLS unemployment rates (2005-2025) ==="
python -m etl.bls_unemployment
echo "=== Unemployment done ==="

echo ""
echo "=== 12/20CalEnviroScreen 4.0 ==="
python -m etl.load_calenviroscreen
echo "=== CalEnviroScreen done ==="

echo ""
echo "=== 13/20Licensed drivers (DMV, 2008-2024) ==="
python -m etl.load_licensed_drivers
echo "=== Licensed drivers done ==="

echo ""
echo "=== 14/20Road miles (Caltrans functional classification) ==="
python -m etl.load_road_miles
echo "=== Road miles done ==="

echo ""
echo "=== 15/20Backfill derived fields (density, alcohol/distraction flags) ==="
python -m etl.backfill_derived
echo "=== Backfill done ==="

echo ""
echo "=== 16/20  Compute data quality stats ==="
python -m etl.compute_data_quality
echo "=== Data quality stats done ==="

echo ""
echo "=== 17/20  Validate crash coordinates ==="
python -m etl.validate_coords
echo "=== Coord validation done ==="

echo ""
echo "=== 18/20  Refresh materialized views (StatsPage aggregates) ==="
python -m etl.refresh_materialized_views
echo "=== Materialized views done ==="

echo ""
echo "=== 19/20  Generate AI insight cards ==="
python -m etl.generate_insights
echo "=== AI insights done ==="

echo ""
echo "=== 20/20  VACUUM ANALYZE (refresh planner statistics) ==="
python -m etl.vacuum_analyze
echo "=== VACUUM ANALYZE done ==="

echo ""
echo "============================================"
echo "  All 20 ETL jobs complete!"
echo "============================================"
