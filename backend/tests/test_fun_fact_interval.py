from etl.generate_fun_facts import _interval_phrase


def test_interval_phrase_never_says_one_minutes():
    # Statewide 2025: 401,632 crashes → 1.31 min apart. Was "every 1 minutes".
    assert _interval_phrase(365 * 24 * 60 / 401_632) == "every 79 seconds"
    assert _interval_phrase(1.0) == "every 60 seconds"
    assert _interval_phrase(2.0) == "every 2 minutes"
    assert _interval_phrase(12.4) == "every 12 minutes"
    assert _interval_phrase(0.5) == "every 30 seconds"
