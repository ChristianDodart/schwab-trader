"""ETF -> underlying grouping.

Single-stock leveraged/inverse ETFs (e.g. "Tradr 2X Long QBTS Daily ETF",
"DEFIANCE DAILY TARGET 2X LONG RCAT ETF") embed their underlying ticker right in
the fund name. We detect that link so the dashboard can nest the ETF under its
underlying stock — decisions about the ETF lean on the underlying's direction
(e.g. its % of 52-week high).

Pure + dependency-free (unit-tested). Auto-detection is best-effort (needs the
name, which enrichment may not have filled yet); a per-account manual override
(see ledger.get_etf_links) is the authoritative fallback.
"""
from __future__ import annotations

import re

# Whole-word uppercase ticker candidates (2–5 letters) inside a fund name.
_SYM_RE = re.compile(r"\b([A-Z]{2,5})\b")
# Name tokens that mark a leveraged/inverse single-stock product.
_NAME_LEV = ("2X", "3X", "-1X", "LEVERAG", "INVERSE", "ULTRAPRO", "ULTRA ",
             "DAILY TARGET", "LONG ", "SHORT ", "BULL", "BEAR")


def is_leveraged_etf(name: str | None, industry: str | None) -> bool:
    """True when the instrument looks like a leveraged/inverse (single-stock) ETF —
    the only kind we group. Broad index ETFs are intentionally NOT grouped."""
    if industry and "leverag" in industry.lower():   # FMP: "Asset Management - Leveraged"
        return True
    up = (name or "").upper()
    if "ETF" in up and any(tok in up for tok in _NAME_LEV):
        return True
    return False


def detect_underlying(name: str | None, industry: str | None,
                      known: set[str], self_sym: str) -> str | None:
    """The underlying ticker for a leveraged ETF, inferred from its name — but only
    when that ticker is one we actually track (`known`), so a stray word can't
    invent a bogus link. Returns None for non-leveraged instruments or no match."""
    if not is_leveraged_etf(name, industry):
        return None
    self_u = self_sym.upper()
    for m in _SYM_RE.finditer((name or "").upper()):
        cand = m.group(1)
        if cand != self_u and cand in known:
            return cand
    return None


def resolve_underlying(name: str | None, industry: str | None, known: set[str],
                       self_sym: str, overrides: dict[str, str] | None = None) -> str | None:
    """Manual override (per-account) wins; else auto-detect from the name. An override
    to "" (or the symbol itself) clears the link."""
    self_u = self_sym.upper()
    if overrides:
        ov = overrides.get(self_u)
        if ov is not None:
            ov = ov.strip().upper()
            return ov if (ov and ov != self_u) else None
    return detect_underlying(name, industry, known, self_sym)
