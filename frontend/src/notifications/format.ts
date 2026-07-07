// Small number/time formatting + text-match helpers shared by the bell's panels.

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const fmtNum = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Local-date key (for grouping) + a friendly label (Today / Yesterday / Mon D).
export function dayKey(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
export function dayLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const k = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (k(d) === k(now)) return "Today";
  if (k(d) === k(y)) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

// History search: case-insensitive match against a row's message or symbol.
export const matchText = (q: string, msg?: string | null, sym?: string | null) =>
  !q || (msg || "").toLowerCase().includes(q.toLowerCase()) || (sym || "").toLowerCase().includes(q.toLowerCase());
