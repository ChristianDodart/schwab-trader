// A styled hover/focus tooltip — an on-theme replacement for the browser's abrupt
// native `title` box. It fades in above the trigger after a 0.5s dwell (the same
// delay as the bulk-button gear reveal) and hides instantly. Pure CSS timing (see
// .tip-* in ui.css), so it also respects prefers-reduced-motion.
export function Tip({
  text, children, style,
}: { text: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span className="tip-host" style={style} tabIndex={0}>
      {children}
      <span className="tip-bubble" role="tooltip">{text}</span>
    </span>
  );
}
