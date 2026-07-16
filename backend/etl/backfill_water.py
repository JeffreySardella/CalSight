"""One-shot historical backfill for the water module.

Runs the three water loaders from their BACKFILL_STARTs (2000) through
today, sequentially. Exists because the run-etl workflow deliberately
accepts only a bare module name (no CLI flags — shell-injection guard),
so `python -m etl.load_reservoirs --backfill` can't be dispatched
remotely; this wraps the same code path behind a flagless module.

Each loader records its own etl_runs row via @track_etl_run, exactly as
its daily run does. Safe to re-run: everything upserts.

Usage:
    python -m etl.backfill_water
"""

import logging
import sys
from datetime import date

from etl import load_drought, load_reservoirs, load_snowpack

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def main() -> int:
    today = date.today()
    for name, module in [
        ("reservoirs", load_reservoirs),
        ("snowpack", load_snowpack),
        ("drought", load_drought),
    ]:
        logger.info(
            "Backfilling %s: %s → %s", name, module.BACKFILL_START, today
        )
        module.run(module.BACKFILL_START, today)
    logger.info("Water backfill complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
