// Desktop (OS pop-up) notification plumbing, shared by the bell and the feed panel.
import type { Notification as AppNotification } from "../types";

export const desktopSupported = typeof window !== "undefined" && "Notification" in window;

export function fireDesktop(n: AppNotification) {
  if (!desktopSupported || Notification.permission !== "granted") return;
  // The server already applied the unified notification prefs and told us whether a
  // desktop pop-up is wanted for this one (mute / per-category / per-symbol). Only an
  // explicit false suppresses; missing = fire (older pushes / safety).
  if (n.desktop === false) return;
  try {
    new Notification(n.symbol ? `${n.symbol} alert` : "Schwab Trader", {
      body: n.message,
      tag: `note-${n.id}`,
    });
  } catch {
    /* some browsers throw if invoked without a user gesture / SW — ignore */
  }
}
