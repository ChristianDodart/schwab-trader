from app import grouping


def test_detects_underlying_from_name():
    known = {"QBTS", "RCAT", "SPY"}
    assert grouping.detect_underlying("Tradr 2X Long QBTS Daily ETF", None, known, "QBTX") == "QBTS"
    assert grouping.detect_underlying("DEFIANCE DAILY TARGET 2X LONG RCAT ETF",
                                      "Asset Management - Leveraged", known, "RCAX") == "RCAT"


def test_no_link_when_underlying_not_tracked():
    # The name references QBTS but we don't hold/track it → no bogus link.
    assert grouping.detect_underlying("Tradr 2X Long QBTS Daily ETF", None, {"AAPL"}, "QBTX") is None


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
