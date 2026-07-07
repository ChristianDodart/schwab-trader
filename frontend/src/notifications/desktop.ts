// Desktop (OS pop-up) notification plumbing, shared by the bell and the feed panel.
import type { Notification as AppNotification } from "../types";

export const desktopSupported = typeof window !== "undefined" && "Notification" in window;

// Which categories may pop a DESKTOP notification (localStorage; default all on). The
// in-app bell always shows everything — these only gate the OS pop-up.
export const DESKTOP_CATS_KEY = "desktop.cats.v1";
export function desktopCats(): Record<string, boolean> {
  try { return { alert: true, trigger: true, fill: true, ...JSON.parse(localStorage.getItem(DESKTOP_CATS_KEY) || "{}") }; }
  catch { return { alert: true, trigger: true, fill: true }; }
}

export function fireDesktop(n: AppNotification) {
  if (!desktopSupported || Notification.permission !== "granted") return;
  if (n.kind && desktopCats()[n.kind] === false) return; // category muted for desktop
  try {
    new Notification(n.symbol ? `${n.symbol} alert` : "Schwab Trader", {
      body: n.message,
      tag: `note-${n.id}`,
    });
  } catch {
    /* some browsers throw if invoked without a user gesture / SW — ignore */
  }
}
