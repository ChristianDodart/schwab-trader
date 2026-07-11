// ============================================================================
// Theme system — a PURE color/surface swap.
//
// A theme sets one attribute (`data-theme`) on <html>; tokens.css maps that to a
// block of semantic color tokens. Motion lives in motion.css and is UNREACHABLE
// from a theme, so switching themes changes only how the app *looks*, never how
// it *feels*. Adding a theme = one `[data-theme]` block in tokens.css + one row
// in THEMES below. Zero component edits.
//
// The swatch colors here mirror each theme's CSS block so the Settings picker can
// preview a theme before it's applied (you can't read an un-applied theme's live
// tokens). Keep them in sync with tokens.css.
// ============================================================================

export type ThemeId =
  | "midnight" | "terminal" | "catppuccin" | "nord" | "gruvbox"
  | "tokyonight" | "rosepine" | "solarized-dark" | "solarized-light"
  | "institutional" | "high-contrast";

export type ThemeChoice = ThemeId | "system";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  group: "Dark" | "Light";
  blurb: string;
  // preview swatches (mirror tokens.css)
  bg: string; surface: string; accent: string; pos: string; neg: string;
}

/** What "Follow system" resolves to for each OS scheme. */
export const DARK_DEFAULT: ThemeId = "midnight";
export const LIGHT_DEFAULT: ThemeId = "institutional";

export const THEMES: ThemeMeta[] = [
  { id: "midnight",        label: "Midnight",         group: "Dark",  blurb: "The signature deep-blue desk.",     bg: "#131317", surface: "#1a1a20", accent: "#4f97ec", pos: "#57cca8", neg: "#f0997b" },
  { id: "terminal",        label: "Terminal",         group: "Dark",  blurb: "Near-black, phosphor green.",        bg: "#0a0d0a", surface: "#0f140f", accent: "#3fd671", pos: "#46d67a", neg: "#f0975a" },
  { id: "catppuccin",      label: "Catppuccin Mocha", group: "Dark",  blurb: "Muted mauve on soft dark.",          bg: "#1e1e2e", surface: "#24243a", accent: "#cba6f7", pos: "#a6e3a1", neg: "#fab387" },
  { id: "nord",            label: "Nord",             group: "Dark",  blurb: "Cool desaturated, low-glare.",       bg: "#2e3440", surface: "#343b48", accent: "#88c0d0", pos: "#a3be8c", neg: "#dd9a80" },
  { id: "gruvbox",         label: "Gruvbox",          group: "Dark",  blurb: "Warm retro earth tones.",            bg: "#282828", surface: "#32302f", accent: "#83a598", pos: "#b8bb26", neg: "#fe8019" },
  { id: "tokyonight",      label: "Tokyo Night",      group: "Dark",  blurb: "Deep indigo, neon blue.",            bg: "#1a1b26", surface: "#1f2335", accent: "#7aa2f7", pos: "#9ece6a", neg: "#ff9e64" },
  { id: "rosepine",        label: "Rosé Pine",        group: "Dark",  blurb: "Rose & pine, low fatigue.",          bg: "#191724", surface: "#1f1d2e", accent: "#c4a7e7", pos: "#9ccfd8", neg: "#ebbcba" },
  { id: "solarized-dark",  label: "Solarized Dark",   group: "Dark",  blurb: "The precision classic, dark.",       bg: "#002b36", surface: "#073642", accent: "#268bd2", pos: "#93c020", neg: "#eb7a3f" },
  { id: "solarized-light", label: "Solarized Light",  group: "Light", blurb: "The precision classic, light.",      bg: "#fdf6e3", surface: "#fbf3da", accent: "#1c7fc4", pos: "#4f6a00", neg: "#b34817" },
  { id: "institutional",   label: "Institutional",    group: "Light", blurb: "Daylight brokerage, navy accent.",   bg: "#f3f6fa", surface: "#ffffff", accent: "#1f4e8c", pos: "#0d7a52", neg: "#bd5518" },
  { id: "high-contrast",   label: "High Contrast",    group: "Dark",  blurb: "Accessibility-first, maximal.",      bg: "#000000", surface: "#0b0b0f", accent: "#66aaff", pos: "#4fe39a", neg: "#ffab5e" },
];

const LS_KEY = "ui.theme.v1";
const VALID = new Set<string>([...THEMES.map((t) => t.id), "system"]);

export function storedChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v && VALID.has(v)) return v as ThemeChoice;
  } catch { /* private mode */ }
  return "system";
}

export function systemPrefersDark(): boolean {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return true; }
}

/** Resolve a choice (which may be "system") to a concrete theme id. */
export function resolveTheme(choice: ThemeChoice): ThemeId {
  return choice === "system" ? (systemPrefersDark() ? DARK_DEFAULT : LIGHT_DEFAULT) : choice;
}

function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

let fadeTimer: ReturnType<typeof setTimeout> | undefined;

// Swap data-theme with per-property transitions frozen for one frame. Chromium
// leaves a transitioned property stale when only its var() input changes (see
// motion.css), so the freeze + reflow forces every property to jump to the new
// theme. Then notify non-CSS consumers (canvas charts) to re-read their colors.
function swapTheme(id: ThemeId, choice: ThemeChoice): void {
  const root = document.documentElement;
  root.classList.add("theme-freeze");
  void root.offsetWidth;          // apply the freeze before the swap
  root.dataset.theme = id;
  void root.offsetWidth;          // reflow with new colors while frozen
  root.classList.remove("theme-freeze");
  try { window.dispatchEvent(new CustomEvent("themechange", { detail: { id, choice } })); } catch { /* no window */ }
}

/**
 * Apply a theme. With `animate`, cross-dissolves the app via a brief #root opacity
 * fade (opacity isn't themed, so it dodges the transition/var staleness bug) and
 * swaps the colors at the dim point. Reduced-motion → instant, correct swap.
 */
export function applyTheme(choice: ThemeChoice, opts: { animate?: boolean } = {}): void {
  const id = resolveTheme(choice);
  const root = document.documentElement;
  const changed = root.dataset.theme !== id;
  const app = typeof document !== "undefined" ? document.getElementById("root") : null;
  const animate = !!opts.animate && changed && !prefersReducedMotion() && !!app;

  if (!animate) { swapTheme(id, choice); return; }

  clearTimeout(fadeTimer);
  // Fade out → swap colors at the bottom → fade back in.
  app!.style.transition = "opacity 130ms cubic-bezier(0.2, 0, 0, 1)";
  app!.style.opacity = "0.4";
  fadeTimer = setTimeout(() => {
    swapTheme(id, choice);
    app!.style.opacity = "1";
    fadeTimer = setTimeout(() => { app!.style.transition = ""; app!.style.opacity = ""; }, 220);
  }, 130);
}

/** Persist + apply an explicit user choice (or "system"). */
export function setThemeChoice(choice: ThemeChoice): void {
  try { localStorage.setItem(LS_KEY, choice); } catch { /* private mode */ }
  applyTheme(choice, { animate: true });
}

// ============================================================================
// App-wide font size — a separate `data-fontsize` attribute (independent of theme).
// ============================================================================
export type FontSize = "small" | "medium" | "large";
const FS_KEY = "ui.fontsize.v1";

export function storedFontSize(): FontSize {
  try {
    const v = localStorage.getItem(FS_KEY);
    if (v === "small" || v === "large" || v === "medium") return v;
  } catch { /* private mode */ }
  return "medium";
}

export function applyFontSize(size: FontSize): void {
  const root = document.documentElement;
  if (size === "medium") root.removeAttribute("data-fontsize"); // default scale = 1
  else root.setAttribute("data-fontsize", size);
}

export function setFontSize(size: FontSize): void {
  try { localStorage.setItem(FS_KEY, size); } catch { /* private mode */ }
  applyFontSize(size);
  try { window.dispatchEvent(new CustomEvent("fontsizechange", { detail: { size } })); } catch { /* no window */ }
}

/** Keep "Follow system" live: re-apply when the OS scheme flips (only while following). */
export function initThemeRuntime(): void {
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener?.("change", () => {
      if (storedChoice() === "system") applyTheme("system", { animate: true });
    });
  } catch { /* no matchMedia */ }
}
