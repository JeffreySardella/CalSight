"""Per-worker daily request budget for paid LLM providers (#293).

A spending backstop: when LLM_DAILY_REQUEST_BUDGET is set (> 0),
``generate_with_fallback`` stops calling paid providers once this many
provider calls have been made today, and the existing simple-mode /
"temporarily unavailable" degradation handles the UX.

Deliberately in-process and per-worker, exactly like the slowapi rate
limits: each gunicorn worker keeps its own counter, so with 4 workers the
effective daily cap is 4 x LLM_DAILY_REQUEST_BUDGET. The counter also
resets on process restart. That imprecision is fine for a budget backstop
and keeps this Redis-free — do not treat it as an exact accounting system.

The unit is "actual provider calls" (each HTTP request to a provider,
including ones that then fail), never cache hits — the ask cache is checked
before any LLM call is attempted.
"""

from __future__ import annotations

import threading
import time

_lock = threading.Lock()
_day: str = ""
_count: int = 0


def _today() -> str:
    # UTC so the reset boundary doesn't depend on server timezone.
    return time.strftime("%Y-%m-%d", time.gmtime())


def try_consume(budget: int) -> bool:
    """Reserve one provider call from today's budget.

    ``budget <= 0`` means unlimited (always True, nothing counted).
    Returns False once today's budget is spent — the caller must then skip
    the paid provider call.
    """
    global _day, _count
    if budget <= 0:
        return True
    today = _today()
    with _lock:
        if _day != today:
            _day = today
            _count = 0
        if _count >= budget:
            return False
        _count += 1
        return True


def used_today() -> int:
    """How many budgeted calls this worker has made today."""
    with _lock:
        return _count if _day == _today() else 0


def reset() -> None:
    """Clear the counter (test hook)."""
    global _day, _count
    with _lock:
        _day = ""
        _count = 0
