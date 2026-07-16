"""backfill_water must run every water loader over its full history."""

from datetime import date
from unittest.mock import patch

from etl import backfill_water, load_drought, load_reservoirs, load_snowpack


def test_runs_all_three_loaders_from_their_backfill_starts():
    with (
        patch.object(load_reservoirs, "run") as res,
        patch.object(load_snowpack, "run") as snow,
        patch.object(load_drought, "run") as drought,
    ):
        assert backfill_water.main() == 0

    today = date.today()
    res.assert_called_once_with(load_reservoirs.BACKFILL_START, today)
    snow.assert_called_once_with(load_snowpack.BACKFILL_START, today)
    drought.assert_called_once_with(load_drought.BACKFILL_START, today)
