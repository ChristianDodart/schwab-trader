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
});
