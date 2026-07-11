// Appearance / theme switcher. Selecting a theme applies it to the whole app
// immediately (live preview) and persists it. Each card previews the theme's
// surface + accent + P/L colors before you commit. "Follow system" tracks the OS
// light/dark setting; an explicit pick always wins.
import { useEffect, useState } from "react";
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

const labelOf = (id: string) => THEMES.find((t) => t.id === id)?.label ?? id;

export function Appearance() {
  const choice = useThemeChoice();
  const applied = resolveTheme(choice); // concrete id currently on <html>
  const followSystem = choice === "system";
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

      <button
        type="button"
        onClick={() => setThemeChoice("system")}
        aria-pressed={followSystem}
        style={{ ...S.systemRow, ...(followSystem ? S.systemRowOn : null) }}
      >
        <span>
          <div style={S.systemTitle}>Follow system</div>
          <div style={S.systemSub}>
            Match your OS light/dark setting
            {followSystem ? ` — currently ${labelOf(applied)}` : ""}
          </div>
        </span>
        {followSystem && <span style={S.check} aria-hidden>✓</span>}
      </button>

      {THEME_GROUPS.map((group) => {
        const items = THEMES.filter((t) => t.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} style={S.section}>
            <div style={S.sectionHead}>
              <span style={S.sectionTitle}>{group}</span>
              <span style={S.sectionCount}>{items.length}</span>
            </div>
            <div style={S.grid}>
              {items.map((t) => (
                <ThemeCard
                  key={t.id}
                  theme={t}
                  selected={!followSystem && choice === t.id}
                  live={followSystem && applied === t.id}
                  onPick={() => setThemeChoice(t.id)}
                />
              ))}
            </div>
          </section>
        );
      })}

      <p style={S.footnote}>
        Themes swap color only — layout, spacing, and motion are identical across every one.
        All themes meet WCAG AA contrast for text and profit/loss colors.
      </p>
    </div>
  );
}

function ThemeCard({
  theme, selected, live, onPick,
}: { theme: ThemeMeta; selected: boolean; live: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      title={theme.blurb}
      style={{ ...S.card, ...(selected ? S.cardOn : null) }}
    >
      <div style={{ ...S.preview, background: theme.bg }}>
        <div style={{ ...S.previewPanel, background: theme.surface }}>
          <span style={{ ...S.dot, background: theme.accent }} />
          <span style={{ ...S.dot, background: theme.pos }} />
          <span style={{ ...S.dot, background: theme.neg }} />
        </div>
      </div>
      <div style={S.cardMeta}>
        <span style={S.cardTitle}>{theme.label}</span>
        {selected && <span style={S.cardCheck} aria-hidden>✓</span>}
        {live && <span style={S.liveTag}>live</span>}
      </div>
    </button>
  );
}

const S: Record<string, React.CSSProperties> = {
  fsRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 },
  fsLabel: { fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)" },
  fsSeg: { display: "inline-flex", gap: 3, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--r-pill)", padding: 3 },
  fsBtn: { border: "none", background: "transparent", color: "var(--text-muted)", fontWeight: 600, fontFamily: "inherit",
    borderRadius: "var(--r-pill)", padding: "3px 14px", cursor: "pointer", lineHeight: 1.3, minWidth: 64 },
  fsBtnOn: { background: "var(--accent-fill)", color: "var(--on-accent)" },
  systemRow: {
    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 12, textAlign: "left", cursor: "pointer",
    background: "var(--panel-2)", color: "var(--text)",
    border: "1px solid var(--border-strong)", borderRadius: "var(--r-md)",
    padding: "10px 14px", marginBottom: 14, fontFamily: "inherit",
  },
  systemRowOn: { borderColor: "var(--accent)", boxShadow: "0 0 0 3px var(--accent-bg)" },
  systemTitle: { fontSize: "var(--fs-sm)", fontWeight: 600 },
  systemSub: { fontSize: "var(--fs-xs)", color: "var(--text-dim)", marginTop: 2 },
  check: { color: "var(--accent)", fontWeight: 700, fontSize: "var(--fs-md)" },

  section: { marginBottom: 18 },
  sectionHead: { display: "flex", alignItems: "center", gap: 8, margin: "0 2px 8px" },
  sectionTitle: {
    fontSize: "var(--fs-2xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
    color: "var(--text-dim)",
  },
  sectionCount: {
    fontSize: 10, fontWeight: 700, color: "var(--text-faint)",
    background: "var(--panel-2)", borderRadius: "var(--r-pill)", padding: "1px 7px",
  },

  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: 10 },

  card: {
    display: "flex", flexDirection: "column", gap: 8, padding: 8, textAlign: "left",
    background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)",
    cursor: "pointer", fontFamily: "inherit",
  },
  cardOn: { borderColor: "var(--accent)", boxShadow: "0 0 0 3px var(--accent-bg)" },

  preview: {
    height: 56, borderRadius: "var(--r-md)", padding: 8,
    display: "flex", alignItems: "flex-end",
    boxShadow: "inset 0 0 0 1px rgba(128,128,128,0.22)",
  },
  previewPanel: {
    display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
    borderRadius: "var(--r-sm)", boxShadow: "inset 0 0 0 1px rgba(128,128,128,0.16)",
  },
  dot: { width: 11, height: 11, borderRadius: "var(--r-pill)", display: "inline-block" },

  cardMeta: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  cardTitle: { fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)" },
  cardCheck: { color: "var(--accent)", fontWeight: 700, fontSize: "var(--fs-sm)" },
  liveTag: {
    fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700,
    color: "var(--accent-quiet)", border: "1px solid var(--border-strong)",
    borderRadius: "var(--r-sm)", padding: "0 4px",
  },
  footnote: { fontSize: "var(--fs-xs)", color: "var(--text-dim)", marginTop: 14, lineHeight: 1.5 },
};
