import { useEffect, useState } from "react";
import type { MarketHours } from "./types";
import { API } from "./api";

export function MarketHoursBadge() {
  const [mh, setMh] = useState<MarketHours | null>(null);
  useEffect(() => {
    const load = () =>
      fetch(`${API}/market-hours`)
        .then((r) => r.json())
        .then(setMh)
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!mh) return null;
  const info = SESSION[mh.session] ?? SESSION.unknown;
  return (
    <span style={{ ...S.mh, color: info.color, borderColor: info.color + "55" }} title={hint(mh)}>
      <span style={{ ...S.mhDot, background: info.color }} />
      {info.label}
    </span>
  );
}

const SESSION: Record<string, { label: string; color: string }> = {
  pre: { label: "Pre-market", color: "var(--warn)" },
  regular: { label: "Market open", color: "var(--pos)" },
  post: { label: "After-hours", color: "var(--warn)" },
  closed: { label: "Market closed", color: "var(--text-dim)" },
  unknown: { label: "Hours n/a", color: "var(--text-dim)" },
};
function hint(mh: MarketHours): string {
  if (!mh.next_change) return mh.session;
  const t = new Date(mh.next_change).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const verb = mh.session === "regular" || mh.session === "pre" || mh.session === "post" ? "next change" : "opens";
  return `${verb} ${t}`;
}

const S: Record<string, React.CSSProperties> = {
  mh: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-xs)", fontWeight: 600, border: "1px solid", borderRadius: "var(--r-pill)", padding: "3px 10px", whiteSpace: "nowrap" },
  mhDot: { width: 7, height: 7, borderRadius: "50%" },
};
