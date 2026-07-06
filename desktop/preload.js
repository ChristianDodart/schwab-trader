// Minimal, safe bridge exposed to the renderer (contextIsolation is ON). The only
// capability granted is starting the Schwab OAuth capture — everything else stays
// same-origin HTTP to the backend.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  // Opens the Schwab login in a dedicated window and resolves with the full
  // redirect URL (…?code=…) captured from the callback, or null if the user
  // closed it / it timed out.
  captureOAuth: (authUrl) => ipcRenderer.invoke("oauth:capture", authUrl),

  // --- auto-update ---
  // Fires when a newer version has finished downloading and is ready to install.
  // Payload: { version, notes }. Returns an unsubscribe fn.
  onUpdateDownloaded: (cb) => {
    const h = (_e, info) => cb(info);
    ipcRenderer.on("updater:downloaded", h);
    return () => ipcRenderer.removeListener("updater:downloaded", h);
  },
  // Fires when a download starts (so the UI can say "downloading…"). Payload: { version }.
  onUpdateAvailable: (cb) => {
    const h = (_e, info) => cb(info);
    ipcRenderer.on("updater:available", h);
    return () => ipcRenderer.removeListener("updater:available", h);
  },
  // Restart now and install the downloaded update.
  installUpdate: () => ipcRenderer.invoke("updater:install"),
});
