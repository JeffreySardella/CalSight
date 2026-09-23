#!/usr/bin/env bash
# Warms the heatmap API's in-process TTL cache (backend/app/routers/heatmap.py,
# _HEATMAP_CACHE_TTL_SECONDS = 6h) so a visitor never eats the cold
# aggregation (Los Angeles took 13.6s uncached). Requests exactly what the
# map asks for (both point budgets, plus the fatal slice) for the 8 busiest
# counties, plus the two statewide low/medium resolutions. The cache key
# ignores batch numbers, so one request per budget is enough.
#
# Shared by two callers:
#   - deploy.yml, right after every fresh (cold-cache) container start
#   - warm-heatmap-cache.yml, a cron just under the 6h TTL, since a deploy
#     doesn't happen every day and the cache would otherwise go cold again
#     mid-afternoon
#
# Best-effort by design in both callers: nothing here ever exits non-zero.
# A slow or failed warm must not fail a deploy, and a scheduled run must not
# fail loudly enough to spam alerts every 5h -- even a total failure (every
# request failed, i.e. the API is down) is left to uptime.yml, which already
# alerts on that from outside the house.
set -u

BASE="${HEATMAP_BASE_URL:-http://127.0.0.1:8000/api/crashes/heatmap}"
RESULTS=$(mktemp)
trap 'rm -f "$RESULTS"' EXIT

# warm <query-string>
# gunicorn runs 4 workers (Dockerfile), each with its own in-process cache,
# and one request lands on one worker: after a single warm a public probe
# still took 13.4s. Eight parallel copies reach every worker (measured: six
# follow-up probes all ~1.7s); a worker that gets two computes once, the
# sync query serialises them.
warm() {
  local qs="$1" i
  for i in 1 2 3 4 5 6 7 8; do
    (
      code=$(curl -s --max-time 90 -o /dev/null -w '%{http_code}' "$BASE?$qs")
      echo "$qs $code" >> "$RESULTS"
    ) &
  done
  wait
}

for county in los-angeles san-diego orange san-bernardino riverside santa-clara alameda sacramento; do
  for q in "max_points=25000" "max_points=80000" "severity=fatal&max_points=25000"; do
    warm "county=$county&resolution=raw&detail=slim&$q"
  done
done
for res in low medium; do
  for budget in 25000 80000; do
    warm "resolution=$res&max_points=$budget"
  done
done

TOTAL=$(wc -l < "$RESULTS" | tr -d ' ')
OK=$(grep -c ' 200$' "$RESULTS" 2>/dev/null || true)
OK=${OK:-0}

echo "Heatmap warm: $OK/$TOTAL requests returned 200"
if [ "$OK" -lt "$TOTAL" ]; then
  echo "Non-200 responses:"
  grep -v ' 200$' "$RESULTS" || true
fi
if [ "$TOTAL" -gt 0 ] && [ "$OK" -eq 0 ]; then
  echo "WARNING: every warm request failed -- API may be down. Not alerting" \
       "here; uptime.yml already covers that from outside the house." >&2
fi

# Best-effort: see file header. Never fail the caller.
exit 0
