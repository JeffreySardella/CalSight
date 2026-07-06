"""Offline quality suite for Ask AI prompt — tests tool functions directly.

Runs test questions through the actual tool functions (hits the DB)
to verify the tools return useful data for common questions.
Does NOT call any LLM API — zero rate limit risk.

Usage:
    DATABASE_URL=postgresql://calsight:PASSWORD@<tailscale-ip>:5433/calsight \
    python -m scripts.check_ai_quality
"""

import json
import os
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, ".")
from app.ai_tools import TOOL_REGISTRY


TEST_CASES = [
    {
        "question": "How does rain affect crash frequency in San Francisco?",
        "tool": "query_crashes",
        "args": {"county": "San Francisco", "group_by": "weather"},
    },
    {
        "question": "Which day of the week has the most crashes statewide?",
        "tool": "query_crashes",
        "args": {"group_by": "day_of_week"},
    },
    {
        "question": "What's the DUI rate in Los Angeles vs San Diego?",
        "tool": "compare_counties",
        "args": {"counties": ["Los Angeles", "San Diego"]},
    },
    {
        "question": "How did crash rates change during COVID (2019 vs 2020)?",
        "tool": "get_trend",
        "args": {"metric": "total_crashes", "year_start": 2019, "year_end": 2020},
    },
    {
        "question": "What time of day do most fatal crashes happen?",
        "tool": "query_crashes",
        "args": {"severity": "Fatal", "group_by": "crash_hour"},
    },
    {
        "question": "Are Saturday night crashes more deadly than Monday morning?",
        "tool": "query_crashes",
        "args": {"day_of_week": 5, "hour": 23},
    },
    {
        "question": "What's the most dangerous road in Orange County?",
        "tool": "query_crashes",
        "args": {"county": "Orange", "group_by": "primary_road"},
    },
    {
        "question": "Show me hit-and-run trends over the last 10 years",
        "tool": "get_trend",
        "args": {"metric": "hit_run_crashes", "year_start": 2014, "year_end": 2024},
    },
    {
        "question": "What percentage of crashes involve pedestrians?",
        "tool": "query_crashes",
        "args": {"pedestrian_involved": True, "years": [2023]},
    },
    {
        "question": "Crash trend for Thursdays over the past 5 years?",
        "tool": "query_crashes",
        "args": {"day_of_week": 3, "group_by": "crash_year", "years": [2020, 2021, 2022, 2023, 2024]},
    },
    {
        "question": "Which county has the worst hit-and-run rate?",
        "tool": "rank_counties",
        "args": {"metric": "hit_run_pct"},
    },
    {
        "question": "How does fog affect crashes?",
        "tool": "query_crashes",
        "args": {"weather": "fog", "group_by": "county_name"},
    },
    {
        "question": "Demographics of Kern County",
        "tool": "get_demographics",
        "args": {"county": "Kern"},
    },
    {
        "question": "Environmental justice scores for Fresno",
        "tool": "get_environmental",
        "args": {"county": "Fresno"},
    },
    {
        "question": "Most dangerous roads in Los Angeles",
        "tool": "query_crashes",
        "args": {"county": "Los Angeles", "group_by": "primary_road", "limit": 10},
    },
]


def run():
    # No hardcoded fallback: this file is public, and a committed connection
    # string is a leaked credential even when it only resolves on the tailnet.
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        sys.exit("Set DATABASE_URL (see module docstring for usage).")
    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)
    db = Session()

    print(f"\n{'='*70}")
    print(f"ASK AI TOOL QUALITY CHECK — {len(TEST_CASES)} test cases")
    print(f"{'='*70}\n")

    passed = 0
    failed = 0

    for i, tc in enumerate(TEST_CASES, 1):
        fn = TOOL_REGISTRY.get(tc["tool"])
        if not fn:
            print(f"[{i:2d}] MISSING TOOL: {tc['tool']}")
            failed += 1
            continue

        try:
            result = fn(db, **tc["args"])
            result_json = json.dumps(result, default=str)
            has_data = bool(result)
            if isinstance(result, dict) and "groups" in result:
                has_data = len(result["groups"]) > 0
            elif isinstance(result, list):
                has_data = len(result) > 0

            icon = "+" if has_data else "-"
            preview = result_json[:120] + "..." if len(result_json) > 120 else result_json
            print(f"[{i:2d}] [{icon}] {tc['question']}")
            print(f"     {tc['tool']}({json.dumps(tc['args'])})")
            print(f"     -> {preview}")
            print()

            if has_data:
                passed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"[{i:2d}] [!] {tc['question']}")
            print(f"     ERROR: {e}")
            print()
            failed += 1

    db.close()

    print(f"{'='*70}")
    print(f"RESULTS: {passed} passed, {failed} failed out of {len(TEST_CASES)}")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    run()
