// Loading placeholders that mirror the real layout, so a load (or account switch)
// reads as "arriving" rather than "broken/empty". Uses the .skeleton class (ui.css).

export function SkeletonTable({ rows = 7, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ marginTop: 16 }} aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 12px", borderBottom: "1px solid var(--border-hairline)" }}>
          <div className="skeleton" style={{ height: 12, width: 72 }} />
          <div style={{ flex: 1 }} />
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="skeleton" style={{ height: 12, width: 46 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ n = 4 }: { n?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginTop: 16 }} aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="panel" style={{ padding: "14px 16px" }}>
          <div className="skeleton" style={{ height: 9, width: 90, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 22, width: 72 }} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPanel({ embedded }: { embedded?: boolean }) {
  return (
    <section className={embedded ? undefined : "panel"} style={{ marginTop: embedded ? 0 : 24, padding: 20 }} aria-hidden="true">
      <div className="skeleton" style={{ height: 20, width: 130, marginBottom: 18 }} />
      <div style={{ display: "flex", gap: 28, marginBottom: 8, flexWrap: "wrap" }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i}>
            <div className="skeleton" style={{ height: 9, width: 52, marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 16, width: 66 }} />
          </div>
        ))}
      </div>
      <SkeletonTable rows={4} cols={6} />
    </section>
  );
}
