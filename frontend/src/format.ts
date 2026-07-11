// Money/percent display formatting — the app-wide dash-for-missing convention.
// (Previously exported from App.tsx, which made every component depend on the
// root shell just to print a dollar figure.)
export const usd = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${(n * 100).toFixed(2)}%`;
