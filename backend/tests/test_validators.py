from etl.validators import validate_row_count, validate_no_nulls_spike


def test_row_count_passes_when_within_threshold():
    result = validate_row_count(
        source="crashes",
        before=100_000,
        after=100_500,
        max_drop_pct=10,
    )
    assert result.passed is True


def test_row_count_fails_when_count_drops_too_much():
    result = validate_row_count(
        source="crashes",
        before=100_000,
        after=40_000,
        max_drop_pct=10,
    )
    assert result.passed is False
    assert "dropped 60.0%" in result.message


def test_row_count_passes_on_first_load():
    result = validate_row_count(
        source="crashes",
        before=0,
        after=50_000,
        max_drop_pct=10,
    )
    assert result.passed is True


def test_row_count_passes_when_count_grows():
    result = validate_row_count(
        source="crashes",
        before=100_000,
        after=200_000,
        max_drop_pct=10,
    )
    assert result.passed is True


def test_validate_no_nulls_spike_passes():
    result = validate_no_nulls_spike(
        source="crashes",
        field="latitude",
        null_pct_before=63.0,
        null_pct_after=64.0,
        max_increase_pct=5.0,
    )
    assert result.passed is True


def test_validate_no_nulls_spike_fails():
    result = validate_no_nulls_spike(
        source="crashes",
        field="latitude",
        null_pct_before=63.0,
        null_pct_after=80.0,
        max_increase_pct=5.0,
    )
    assert result.passed is False
