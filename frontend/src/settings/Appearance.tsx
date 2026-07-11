// Appearance / theme switcher. A compact dropdown (with a live preview swatch on
// the trigger and on every option) picks the theme, so the Settings page stays
// short no matter how many themes ship. Selecting applies to the whole app
// immediately and persists it. "Follow system" tracks the OS light/dark setting;
// an explicit pick always wins. The menu is portaled to <body> so it's never
// clipped by the Settings scroll container.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  THEMES, THEME_GROUPS, storedChoice, setThemeChoice, resolveTheme,
  storedFontSize, setFontSize,
  type ThemeChoice, type ThemeMeta, type FontSize,
} from "../theme";

function useThemeChoice(): ThemeChoice {
  const [choice, setChoice] = useState<ThemeChoice>(() => storedChoice());
  useEffect(() => {
    const sync = () => setChoice(storedChoice());
    window.addEventListener("themechange", sync);
    return () => window.removeEventListener("themechange", sync);
  }, []);
  return choice;
}

function useFontSize(): FontSize {
  const [fs, setFs] = useState<FontSize>(() => storedFontSize());
  useEffect(() => {
    const sync = () => setFs(storedFontSize());
    window.addEventListener("fontsizechange", sync);
    return () => window.removeEventListener("fontsizechange", sync);
  }, []);
  return fs;
}

const FONT_SIZES: Array<{ id: FontSize; label: string; px: number }> = [
  { id: "small", label: "Small", px: 13 },
  { id: "medium", label: "Medium", px: 15 },
  { id: "large", label: "Large", px: 18 },
];

const SYSTEM = "system"; // hover-id sentinel for the "Follow system" row

export function Appearance() {
  const choice = useThemeChoice();
  const applied = resolveTheme(choice); // concrete id currently on <html>
  const fontSize = useFontSize();

  return (
    <div>
      <div style={S.fsRow}>
        <span style={S.fsLabel}>Font size</span>
        <div style={S.fsSeg} role="group" aria-label="App font size">
          {FONT_SIZES.map((f) => (
            <button key={f.id} type="button" aria-pressed={fontSize === f.id}
              onClick={() => setFontSize(f.id)}
              title={`${f.label} — scales the whole app`}
              style={{ ...S.fsBtn, ...(fontSize === f.id ? S.fsBtnOn : null), fontSize: f.px }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <label style={S.fieldLabel} id="theme-field-label">Theme</label>
      <ThemeSelect choice={choice} applied={applied} />

      <p style={S.footnote}>
        Themes swap color only — layout, spacing, and motion are identical across every one.
        All themes meet WCAG AA contrast for text and profit/loss colors.
      </p>
    </div>
  );
}

// The dropdown. Trigger shows the current theme; the portaled menu lists every
// theme grouped, each with its own preview, and scrolls internally if tall.
function ThemeSelect({ choice, applied }: { choice: ThemeChoice; applied: string }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const followSystem = choice === "system";
  const current = THEMES.find((t) => t.id === applied);

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({
      left: r.left,
      top: r.bottom + 6,
      width: Math.max(r.width, 300),
      maxH: Math.max(200, window.innerHeight - r.bottom - 18),
    });
  }, []);

  const close = useCallback(() => { setOpen(false); setHover(null); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); btnRef.current?.focus(); }
    };
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      close();
    };
    // Close if any ancestor scrolls (the menu is fixed and would drift), but not
    // when the scroll happens inside the menu's own list.
    const onScroll = (e: Event) => {
      if (popRef.current && e.target instanceof Node && popRef.current.contains(e.target)) return;
      close();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  const toggle = () => { if (open) { close(); } else { place(); setOpen(true); } };
  const pick = (c: ThemeChoice) => { setThemeChoice(c); close(); btnRef.current?.focus(); };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="theme-field-label"
        style={{ ...S.trigger, ...(open ? S.triggerOpen : null) }}
      >
        <Swatch theme={current} />
        <span style={S.triggerText}>
          <span style={S.triggerLabel}>{followSystem ? "Follow system" : current?.label ?? "—"}</span>
          <span style={S.triggerSub}>
            {followSystem ? `Matches your OS — currently ${current?.label ?? "—"}` : current?.group}
          </span>
        </span>
        <span style={S.chev}><Chevron open={open} /></span>
      </button>

      {open && rect && createPortal(
        <div
          ref={popRef}
          role="listbox"
          aria-label="Theme"
          style={{ ...S.pop, left: rect.left, top: rect.top, width: rect.width, maxHeight: rect.maxH }}
        >
          <button
            type="button" role="option" aria-selected={followSystem}
            onClick={() => pick("system")}
            onMouseEnter={() => setHover(SYSTEM)} onMouseLeave={() => setHover(null)}
            style={{ ...S.opt, ...(followSystem ? S.optOn : hover === SYSTEM ? S.optHover : null) }}
          >
            <span style={S.systemGlyph} aria-hidden>◐</span>
            <span style={S.optText}>
              <span style={S.optLabel}>Follow system</span>
              <span style={S.optSub}>Match your OS light/dark setting</span>
            </span>
            {followSystem && <span style={S.optCheck} aria-hidden>✓</span>}
          </button>

          {THEME_GROUPS.map((group) => {
            const items = THEMES.filter((t) => t.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} role="group" aria-label={group}>
                <div style={S.groupHead} aria-hidden>
                  {group}<span style={S.groupCount}>{items.length}</span>
                </div>
                {items.map((t) => {
                  const sel = !followSystem && choice === t.id;
                  return (
                    <button
                      key={t.id} type="button" role="option" aria-selected={sel}
                      onClick={() => pick(t.id)}
                      onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)}
                      title={t.blurb}
                      style={{ ...S.opt, ...(sel ? S.optOn : hover === t.id ? S.optHover : null) }}
                    >
                      <Swatch theme={t} />
                      <span style={S.optText}>
                        <span style={S.optLabel}>{t.label}</span>
                        <span style={S.optSub}>{t.blurb}</span>
                      </span>
                      {sel && <span style={S.optCheck} aria-hidden>✓</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

// A miniature of a theme: its background, an inner panel, and accent/pos/neg dots.
function Swatch({ theme }: { theme?: ThemeMeta }) {
  if (!theme) return <span style={{ ...S.sw, background: "var(--panel-2)" }} />;
  return (
    <span style={{ ...S.sw, background: theme.bg }}>
      <span style={{ ...S.swPanel, background: theme.surface }}>
        <span style={{ ...S.swDot, background: theme.accent }} />
        <span style={{ ...S.swDot, background: theme.pos }} />
        <span style={{ ...S.swDot, background: theme.neg }} />
      </span>
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={{ transform: open ? "rotate(180deg)" : "none" }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

const S: Record<string, React.CSSProperties> = {
  fsRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 },
  fsLabel: { fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)" },
  fsSeg: { display: "inline-flex", gap: 3, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--r-pill)", padding: 3 },
  fsBtn: { border: "none", background: "transparent", color: "var(--text-muted)", fontWeight: 600, fontFamily: "inherit",
    borderRadius: "var(--r-pill)", padding: "3px 14px", cursor: "pointer", lineHeight: 1.3, minWidth: 64 },
  fsBtnOn: { background: "var(--accent-fill)", color: "var(--on-accent)" },

  fieldLabel: { display: "block", fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)", marginBottom: 8 },

  // Trigger
  trigger: {
    width: "100%", display: "flex", alignItems: "center", gap: 10, textAlign: "left",
    background: "var(--panel-2)", color: "var(--text)",
    border: "1px solid var(--border-strong)", borderRadius: "var(--r-md)",
    padding: "8px 12px", cursor: "pointer", fontFamily: "inherit",
  },
  triggerOpen: { borderColor: "var(--accent)", boxShadow: "0 0 0 3px var(--accent-bg)" },
  triggerText: { display: "flex", flexDirection: "column", minWidth: 0, flex: 1 },
  triggerLabel: { fontSize: "var(--fs-sm)", fontWeight: 600, lineHeight: 1.2 },
  triggerSub: { fontSize: "var(--fs-2xs)", color: "var(--text-dim)", marginTop: 1 },
  chev: { display: "inline-flex", marginLeft: "auto", color: "var(--text-dim)", flexShrink: 0 },

  // Menu
  pop: {
    position: "fixed", zIndex: "var(--z-popover)" as unknown as number, overflowY: "auto",
    background: "var(--pop)", border: "1px solid var(--border-strong)",
    borderRadius: "var(--r-md)", boxShadow: "var(--shadow-pop)", padding: 6,
  },
  opt: {
    width: "100%", display: "flex", alignItems: "center", gap: 10, textAlign: "left",
    background: "transparent", color: "var(--text)", border: "1px solid transparent",
    borderRadius: "var(--r-sm)", padding: "6px 8px", cursor: "pointer", fontFamily: "inherit",
  },
  optHover: { background: "var(--surface-hi)" },
  optOn: { background: "var(--accent-bg)", borderColor: "var(--accent)" },
  optText: { display: "flex", flexDirection: "column", minWidth: 0, flex: 1 },
  optLabel: { fontSize: "var(--fs-sm)", fontWeight: 600, lineHeight: 1.2 },
  optSub: { fontSize: "var(--fs-2xs)", color: "var(--text-dim)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  optCheck: { color: "var(--accent)", fontWeight: 700, marginLeft: "auto", flexShrink: 0, fontSize: "var(--fs-sm)" },

  groupHead: {
    display: "flex", alignItems: "center", gap: 6, padding: "9px 8px 4px",
    fontSize: "var(--fs-2xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
    color: "var(--text-faint)",
  },
  groupCount: { fontSize: 10, fontWeight: 700, color: "var(--text-faint)", background: "var(--panel-2)", borderRadius: "var(--r-pill)", padding: "0 6px" },
  systemGlyph: { width: 46, height: 30, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 20, color: "var(--accent)" },

  // Swatch
  sw: {
    width: 46, height: 30, borderRadius: "var(--r-sm)", padding: 5, display: "flex", alignItems: "flex-end",
    flexShrink: 0, boxShadow: "inset 0 0 0 1px rgba(128,128,128,0.25)",
  },
  swPanel: { display: "flex", alignItems: "center", gap: 3, padding: "3px 4px", borderRadius: 3, boxShadow: "inset 0 0 0 1px rgba(128,128,128,0.18)" },
  swDot: { width: 6, height: 6, borderRadius: "var(--r-pill)", display: "inline-block" },

  footnote: { fontSize: "var(--fs-xs)", color: "var(--text-dim)", marginTop: 16, lineHeight: 1.5 },
};
