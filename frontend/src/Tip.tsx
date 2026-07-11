// A styled hover/focus tooltip. Renders its bubble into a portal at <body> with
// position:fixed, so it is NEVER clipped by an ancestor's overflow (the reason the
// old CSS-only version broke inside the scrollable table). Appears after a 0.5s
// dwell (same as the gear reveal), fades/rises in, and hides on leave or scroll.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TipPos = { x: number; y: number; above: boolean };

export function Tip({
  text, children, className, style, focusable = true,
}: {
  text: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  focusable?: boolean; // headers pass false to avoid a tab stop per column
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pos, setPos] = useState<TipPos | null>(null);

  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const above = r.top > 120; // flip below when too near the top to fit above
      const x = Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140);
      setPos({ x, y: above ? r.top - 8 : r.bottom + 8, above });
    }, 500);
  };
  const hide = () => { clearTimeout(timer.current); setPos(null); };

  useEffect(() => () => clearTimeout(timer.current), []);
  // While shown, dismiss on any scroll/resize (the fixed bubble would otherwise drift).
  useEffect(() => {
    if (!pos) return;
    const off = () => hide();
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    return () => { window.removeEventListener("scroll", off, true); window.removeEventListener("resize", off); };
  }, [pos]);

  return (
    <span
      ref={ref}
      className={`tip-host${className ? " " + className : ""}`}
      style={style}
      tabIndex={focusable ? 0 : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={focusable ? show : undefined}
      onBlur={focusable ? hide : undefined}
    >
      {children}
      {pos && createPortal(
        <div
          className="tip-anchor"
          style={{ left: pos.x, top: pos.y, transform: pos.above ? "translate(-50%, -100%)" : "translate(-50%, 0)" }}
        >
          <div className={`tip-pop ${pos.above ? "tip-above" : "tip-below"}`} role="tooltip">{text}</div>
        </div>,
        document.body,
      )}
    </span>
  );
}
