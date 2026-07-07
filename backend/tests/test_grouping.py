from app import grouping


def test_detects_underlying_from_name():
    known = {"QBTS", "RCAT", "SPY"}
    assert grouping.detect_underlying("Tradr 2X Long QBTS Daily ETF", None, known, "QBTX") == "QBTS"
    assert grouping.detect_underlying("DEFIANCE DAILY TARGET 2X LONG RCAT ETF",
                                      "Asset Management - Leveraged", known, "RCAX") == "RCAT"


def test_no_link_when_underlying_not_tracked():
    # The name references QBTS but we don't hold/track it → no bogus link.
    assert grouping.detect_underlying("Tradr 2X Long QBTS Daily ETF", None, {"AAPL"}, "QBTX") is None


def test_prefix_fallback_when_name_missing():
    # Leveraged ETF (known only via industry, name not yet enriched) whose ticker
    # echoes the underlying's prefix → link by prefix. CRWG↔CRWV, SOFX↔SOFI.
    known = {"CRWV", "SOFI", "QBTS"}
    assert grouping.detect_underlying(None, "Asset Management - Leveraged", known, "CRWG") == "CRWV"
    assert grouping.detect_underlying(None, "Asset Management - Leveraged", known, "SOFX") == "SOFI"


def test_prefix_fallback_no_match_when_underlying_absent():
    # MRAL's underlying isn't held → nothing shares its "MRA" prefix → stays unlinked.
    assert grouping.detect_underlying(None, "Asset Management - Leveraged",
                                      {"CRWV", "SOFI"}, "MRAL") is None


def test_prefix_fallback_ambiguous_skips():
    # Two known symbols share the prefix → ambiguous → no guess.
    known = {"SOFI", "SOFL"}  # both start "SOF"
    assert grouping.detect_underlying(None, "Asset Management - Leveraged", known, "SOFX") is None


def test_prefix_fallback_only_for_leveraged():
    # A non-leveraged instrument never prefix-links, even with a prefix-mate present.
    assert grouping.detect_underlying("COREWEAVE INC A", "Software - Infrastructure",
                                      {"CRWV"}, "CRWX") is None


def test_name_match_wins_over_prefix():
    # Name names QBTS (matched first); the "QBT" prefix alone would be ambiguous
    # (QBTS + QBTT) and skip — so a QBTS result proves the name match ran first.
    assert grouping.detect_underlying("Tradr 2X Long QBTS Daily ETF", None,
                                      {"QBTS", "QBTT"}, "QBTX") == "QBTS"


def test_non_leveraged_never_links():
    assert grouping.detect_underlying("D-WAVE QUANTUM INC", "Computer Hardware", {"QBTS"}, "QBTS") is None
    # Broad index ETF is intentionally not grouped.
    assert grouping.detect_underlying("SPDR S&P 500 ETF Trust", None, {"AAPL"}, "SPY") is None


def test_is_leveraged_etf():
    assert grouping.is_leveraged_etf("Tradr 2X Long QBTS Daily ETF", None)
    assert grouping.is_leveraged_etf(None, "Asset Management - Leveraged")
    assert not grouping.is_leveraged_etf("D-WAVE QUANTUM INC", "Computer Hardware")
    assert not grouping.is_leveraged_etf(None, None)


def test_override_wins_and_clears():
    known = {"QBTS", "RCAT"}
    # Manual override points elsewhere → used verbatim.
    assert grouping.resolve_underlying("Tradr 2X Long QBTS Daily ETF", None, known, "QBTX",
                                       {"QBTX": "RCAT"}) == "RCAT"
    # Blank override clears the auto-detected link.
    assert grouping.resolve_underlying("Tradr 2X Long QBTS Daily ETF", None, known, "QBTX",
                                       {"QBTX": ""}) is None
    # Self-reference is not a link.
    assert grouping.resolve_underlying("Tradr 2X Long QBTS Daily ETF", None, known, "QBTX",
                                       {"QBTX": "QBTX"}) is None
    # No override → falls back to auto-detect.
    assert grouping.resolve_underlying("Tradr 2X Long QBTS Daily ETF", None, known, "QBTX", {}) == "QBTS"
