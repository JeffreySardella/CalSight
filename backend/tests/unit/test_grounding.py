"""Tests for the numeric-grounding heuristic (#293).

Pure-function tests — no DB, no LLM. The heuristic backs the `grounded`
flag downgrade in /api/ask: an answer whose tool results contained
distinctive numbers but which cites none of them is not data-backed.
"""

from __future__ import annotations

from app.grounding import answer_cites_tool_numbers, extract_distinctive_numbers


# ── extract_distinctive_numbers ──────────────────────────────────────────


def test_extracts_plain_integers():
    assert extract_distinctive_numbers("there were 8234 crashes") == {8234.0}


def test_normalizes_comma_grouped_numbers():
    assert extract_distinctive_numbers("Rain: 8,234 vs Clear: 62,105") == {8234.0, 62105.0}


def test_comma_grouped_and_plain_forms_compare_equal():
    assert extract_distinctive_numbers("8,234") == extract_distinctive_numbers("8234")


def test_extracts_decimals_even_below_ten():
    # 3.2 is a rate/percentage — distinctive despite being < 10.
    assert extract_distinctive_numbers("fatality rate was 3.2%") == {3.2}


def test_ignores_small_integers():
    assert extract_distinctive_numbers("top 5 counties, 3 of them rural, 9 total") == set()


def test_keeps_integers_at_and_above_cutoff():
    assert extract_distinctive_numbers("10 crashes and 42 injuries") == {10.0, 42.0}


def test_ignores_years():
    assert extract_distinctive_numbers("from 2001 to 2024, and back in 1999") == set()


def test_ignores_year_boundaries_but_keeps_neighbors():
    assert extract_distinctive_numbers("1900 2100 1899 2101") == {1899.0, 2101.0}


def test_year_like_decimal_is_distinctive():
    # 2023.5 is a value, not a year.
    assert extract_distinctive_numbers("index of 2023.5") == {2023.5}


def test_comma_separated_years_do_not_merge():
    # "2019,2020" must not be read as the single number 20192020.
    assert extract_distinctive_numbers("years 2019,2020") == set()


def test_json_payload_numbers_are_extracted():
    payload = '[{"county": "Los Angeles", "crash_count": 54321, "fatality_rate_pct": 1.42}]'
    assert extract_distinctive_numbers(payload) == {54321.0, 1.42}


def test_empty_and_number_free_text():
    assert extract_distinctive_numbers("") == set()
    assert extract_distinctive_numbers("no data available for that county") == set()


def test_trailing_dot_is_not_a_decimal():
    # "8234." (end of sentence) parses as 8234, not a malformed float.
    assert extract_distinctive_numbers("the count was 8234.") == {8234.0}


# ── answer_cites_tool_numbers ────────────────────────────────────────────


def test_shared_number_counts_as_cited():
    assert answer_cites_tool_numbers(
        "There were 8,234 crashes in the rain.",
        ['{"crash_count": 8234}'],
    )


def test_no_overlap_is_not_cited():
    assert not answer_cites_tool_numbers(
        "Rain is associated with more crashes than clear weather.",
        ['{"rain": 8234, "clear": 62105}'],
    )


def test_hallucinated_numbers_are_not_cited():
    assert not answer_cites_tool_numbers(
        "About 99,999 crashes happened in the rain.",
        ['{"rain": 8234, "clear": 62105}'],
    )


def test_tool_results_without_distinctive_numbers_never_downgrade():
    # Nothing to cross-check against — "no data" answers are legitimate.
    assert answer_cites_tool_numbers(
        "No party data exists before 2016.",
        ['{"error_note": "no rows"}', '{"count": 3, "year": 2016}'],
    )


def test_empty_tool_results_never_downgrade():
    assert answer_cites_tool_numbers("anything at all", [])


def test_year_only_overlap_does_not_count():
    # Sharing "2023" with the tool payload is not evidence of grounding.
    assert not answer_cites_tool_numbers(
        "In 2023 there were roughly 90,000 crashes.",
        ['{"year": 2023, "crash_count": 54321}'],
    )


def test_small_int_overlap_does_not_count():
    assert not answer_cites_tool_numbers(
        "The top 5 counties account for most crashes, about 70,000.",
        ['{"limit": 5, "total": 54321}'],
    )


def test_one_shared_number_among_many_is_enough():
    assert answer_cites_tool_numbers(
        "Fresno had 12,345 crashes; other counties varied.",
        ['[{"county": "Fresno", "n": 12345}, {"county": "Kern", "n": 23456}]'],
    )


def test_decimal_rate_citation_counts():
    assert answer_cites_tool_numbers(
        "The fatality rate was 1.42%, higher than average.",
        ['{"fatality_rate_pct": 1.42, "crash_count": 54321}'],
    )


def test_comma_formatting_difference_still_matches():
    assert answer_cites_tool_numbers(
        "There were 62,105 crashes in clear weather.",
        ['{"clear": 62105}'],
    )


def test_number_in_chart_block_counts_as_cited():
    # The raw answer (before chart stripping) is checked, so a chart citing
    # tool numbers keeps the answer grounded.
    answer = (
        "Crashes varied by weather.\n---\n"
        'Chart: {"type": "bar", "data": [{"label": "Rain", "value": 8234}]}'
    )
    assert answer_cites_tool_numbers(answer, ['{"rain": 8234}'])


def test_overlap_across_multiple_tool_results():
    assert answer_cites_tool_numbers(
        "Kern county reported 23,456 crashes.",
        ['{"fresno": 12345}', '{"kern": 23456}'],
    )
