import { useEffect, useState } from "react";
import { SS } from "./ui";

/** Desktop-only settings that live in the Electron shell, not the backend config.
 * Currently one toggle: "run in the system tray." When on, minimizing or closing the
 * window hides the app to the tray and keeps it running (updates + alerts keep flowing)
 * instead of quitting. Applies immediately and persists on this install; it's not part
 * of the dirty-tracked account config, so it saves itself. Only rendered on the desktop
 * app (the Settings shell gates this behind window.desktop.isDesktop). */
export function DesktopSection() {
  const [tray, setTray] = useState<boolean | null>(null); // null = still loading

  useEffect(() => {
    let alive = true;
    window.desktop?.getTrayPref?.().then((v) => { if (alive) setTray(!!v); });
    return () => { alive = false; };
  }, []);

  const toggle = async (on: boolean) => {
    setTray(on); // optimistic — the shell echoes back the applied value
    const applied = await window.desktop?.setTrayPref?.(on);
    if (typeof applied === "boolean") setTray(applied);
  };

  return (
    <label style={SS.toggle}>
      <input type="checkbox" checked={!!tray} disabled={tray === null}
        onChange={(e) => toggle(e.target.checked)} />
      Run in the system tray — minimizing or closing the window keeps the app running in
      the tray (so updates and price alerts keep working) instead of quitting.
    </label>
  );
}
