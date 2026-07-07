import { useId, useRef, useState } from "react";

/** Shared hover/focus tooltip popover — the on-theme replacement for long native
 * `title` strings in info-dense spots (Ledger cards, Settings cash-check). The
 * trigger is keyboard-focusable; hover or focus opens, Escape/blur closes, and
 * focus stays on the trigger when Escape closes it. Keep plain native `title`
 * attributes for short, low-stakes hints elsewhere. */
export function Hint({ label, children, width = 280, align = "left" }: {
  label: React.ReactNode;      // popover content (plain string or nodes)
  children: React.ReactNode;   // the trigger (glyph / text) the popover anchors to
  width?: number;
  align?: "left" | "right";    // which edge of the trigger the popover hugs
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const id = useId();
  return (
    <span style={S.wrap} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();       // don't also close an enclosing popover/modal
            setOpen(false);
            triggerRef.current?.focus(); // focus returns to (stays on) the trigger
          }
        }}
        style={S.trigger}
      >
        {children}
      </span>
      {open && (
        <span role="tooltip" id={id}
          style={{ ...S.tip, width, left: align === "left" ? 0 : undefined, right: align === "right" ? 0 : undefined }}>
          {label}
        </span>
      )}
    </span>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { position: "relative", display: "inline-flex" },
  trigger: { display: "inline-flex", alignItems: "center", cursor: "help" },
  // Mirrors the NoteDot popover in DashboardTable: panel bg, border, r-md, fs-xs.
  // Resets uppercase/letter-spacing so it reads normally inside eyebrow labels.
  tip: {
    position: "absolute", top: "calc(100% + 6px)",
    zIndex: "var(--z-popover)" as unknown as number,
    background: "var(--pop)", color: "var(--text)", border: "1px solid var(--border)",
    borderRadius: "var(--r-md)", boxShadow: "var(--shadow-pop)", padding: "8px 10px",
    fontSize: "var(--fs-xs)", fontWeight: 400, lineHeight: 1.45, whiteSpace: "pre-wrap",
    textAlign: "left", cursor: "default", textTransform: "none", letterSpacing: 0,
  },
};
