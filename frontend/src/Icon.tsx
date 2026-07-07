// Centralized icon set — a thin, typed wrapper around lucide-react so every
// icon in the app is imported from one place with consistent sizing and inline
// alignment. lucide renders inline SVGs bundled by Vite (fully offline) and
// inherits the parent's text color via `color: currentColor`, so icons theme
// automatically from tokens.css. No emoji, no fallback.
import type { CSSProperties, ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import {
  Bell,
  Settings,
  RefreshCw,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Download,
  Upload,
  ExternalLink,
  Check,
  Plus,
  CornerDownRight,
  TriangleAlert,
  OctagonAlert,
  Circle,
  Pause,
  Play,
  Search,
  Trash2,
  Pencil,
  GripVertical,
} from "lucide-react";

// Default visual size (px). Tuned to sit comfortably next to the app's text.
const DEFAULT_SIZE = 15;

// Nudge icons onto the text baseline so they sit inline with adjacent labels.
const BASE_STYLE: CSSProperties = { verticalAlign: "-0.125em", flexShrink: 0 };

export type IconProps = Omit<LucideProps, "ref">;

// Wrap a lucide component with the app defaults. Callers can still override
// size / color / strokeWidth / style / className / aria-label — everything
// passes straight through to the underlying SVG.
function icon(Cmp: ComponentType<LucideProps>, displayName: string) {
  function Wrapped({ size = DEFAULT_SIZE, style, ...rest }: IconProps) {
    // Decorative by default; a button/label supplies its own aria-label, and
    // when a caller passes aria-label the icon becomes announced instead.
    const decorative = rest["aria-label"] == null && rest["aria-hidden"] == null;
    return (
      <Cmp
        size={size}
        aria-hidden={decorative ? true : undefined}
        style={{ ...BASE_STYLE, ...style }}
        {...rest}
      />
    );
  }
  Wrapped.displayName = `Icon(${displayName})`;
  return Wrapped;
}

// Semantic icon set — named for the app's uses, mapped to lucide components.
export const IconBell = icon(Bell, "Bell");               // notification bell
export const IconSettings = icon(Settings, "Settings");   // gear / configure
export const IconRefresh = icon(RefreshCw, "Refresh");    // sync / reload
export const IconClose = icon(X, "Close");                // close / remove / dismiss
export const IconChevronDown = icon(ChevronDown, "ChevronDown"); // caret / dropdown
export const IconChevronLeft = icon(ChevronLeft, "ChevronLeft"); // prev
export const IconChevronRight = icon(ChevronRight, "ChevronRight"); // next / expand
export const IconArrowUp = icon(ArrowUp, "ArrowUp");
export const IconArrowDown = icon(ArrowDown, "ArrowDown");
export const IconDownload = icon(Download, "Download");   // CSV / export
export const IconUpload = icon(Upload, "Upload");         // CSV / import
export const IconExternalLink = icon(ExternalLink, "ExternalLink"); // open external
export const IconCheck = icon(Check, "Check");
export const IconPlus = icon(Plus, "Plus");
export const IconChildArrow = icon(CornerDownRight, "ChildArrow"); // ETF child / "tracks"
export const IconWarning = icon(TriangleAlert, "Warning"); // advisory / warning
export const IconBlocked = icon(OctagonAlert, "Blocked");  // expired / hard error
export const IconDot = icon(Circle, "Dot");               // unread / unsaved dot
export const IconPause = icon(Pause, "Pause");
export const IconPlay = icon(Play, "Play");
export const IconSearch = icon(Search, "Search");
export const IconTrash = icon(Trash2, "Trash");
export const IconEdit = icon(Pencil, "Edit");
export const IconGrip = icon(GripVertical, "Grip");      // drag-to-reorder handle
