// Electron main process for the packaged Schwab Trader desktop app.
//
// Responsibilities:
//   1. Spawn the PyInstaller'd backend exe (the "sidecar"), pointing it at a
//      per-user data dir (userData) and the bundled frontend so it serves the SPA
//      same-origin (no CORS).
//   2. Wait for the backend to answer, then load the window at http://localhost:PORT/.
//   3. Auto-update from GitHub Releases (electron-updater).
//   4. Kill the sidecar on quit.
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

// The frontend uses RELATIVE URLs in prod and the backend serves it same-origin, so
// we can bind ANY free port — no fixed 8000, no conflict with a dev server / other app.
let PORT = 0;
let BASE = "";
const isDev = !app.isPackaged;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

let backend = null;
let win = null;

// Resolve the sidecar exe + bundled frontend dist for dev vs packaged.
function paths() {
  if (isDev) {
    return {
      exe: path.join(__dirname, "..", "backend", "dist", "schwab-backend", "schwab-backend.exe"),
      frontend: path.join(__dirname, "..", "frontend", "dist"),
    };
  }
  return {
    exe: path.join(process.resourcesPath, "schwab-backend", "schwab-backend.exe"),
    frontend: path.join(process.resourcesPath, "frontend"),
  };
}

let backendExited = false;

function startBackend() {
  const { exe, frontend } = paths();
  if (!fs.existsSync(exe)) {
    dialog.showErrorBox("Startup failed", `The engine executable is missing:\n${exe}`);
    app.quit();
    return;
  }
  // Route sidecar stdout/stderr to a log in the data dir so first-run failures are
  // diagnosable (was discarded before). stdin is PIPED as a death-tether: when
  // Electron exits, the OS closes the pipe → the backend sees EOF and exits itself,
  // so a hard Electron crash can't leave an orphaned engine holding the SQLite file.
  let logFd = "ignore";
  try {
    logFd = fs.openSync(path.join(app.getPath("userData"), "backend.log"), "a");
  } catch (e) { /* fall back to discarding output */ }
  backend = spawn(exe, [], {
    env: {
      ...process.env,
      SCHWAB_DATA_DIR: app.getPath("userData"), // per-user: DB + encrypted tokens live here
      SCHWAB_PORT: String(PORT),
      SCHWAB_FRONTEND_DIR: frontend, // backend serves the SPA same-origin
    },
    stdio: ["pipe", logFd, logFd],
    windowsHide: true,
  });
  backend.on("error", (e) => {
    dialog.showErrorBox("Startup failed", `Could not start the engine:\n${e.message}\n${exe}`);
    app.quit();
  });
  backend.on("exit", (code) => {
    backendExited = true;
    if (code && code !== 0 && win) {
      dialog.showErrorBox("Backend stopped", `The Schwab Trader engine exited (code ${code}).\nSee backend.log in the app data folder.`);
    }
  });
}

// Poll the backend's /health until it answers 200 (or the sidecar dies / we time out).
function waitForBackend(cb, tries = 60) {
  const ping = () => {
    if (backendExited) { dialog.showErrorBox("Startup failed", "The engine exited during startup — see backend.log."); app.quit(); return; }
    http.get(`${BASE}/health`, (r) => {
      if (r.statusCode === 200) { r.resume(); cb(); }
      else { r.resume(); retry(); }
    }).on("error", retry);
  };
  const retry = () => {
    if (--tries <= 0) { dialog.showErrorBox("Startup failed", "The engine didn't start in time."); app.quit(); return; }
    setTimeout(ping, 500);
  };
  ping();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: "#0b0e13",
    title: "Schwab Trader",
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, "preload.js") },
  });
  win.removeMenu();
  win.loadURL(BASE + "/");
  win.on("closed", () => { win = null; });
  // The app window must never navigate away from the app (a stray external link
  // would strand the user with no address bar). Open externals in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(BASE)) { e.preventDefault(); shell.openExternal(url); }
  });
}

// Auto-capture the Schwab OAuth redirect: open the login in a dedicated window and
// grab the code off the callback URL before it tries to load the (dead) loopback —
// no copy-paste, no local listener, no cert. Fresh session each time so switching
// profiles (e.g. logging in as Dave) doesn't reuse a prior Schwab session.
ipcMain.handle("oauth:capture", (_evt, authUrl) => new Promise((resolve) => {
  const CALLBACK = "https://127.0.0.1";
  const authWin = new BrowserWindow({
    width: 520, height: 720, parent: win || undefined, modal: !!win, show: true,
    title: "Sign in to Schwab", backgroundColor: "#0b0e13",
    webPreferences: { partition: "oauth-" + Date.now(), contextIsolation: true, nodeIntegration: false },
  });
  authWin.removeMenu();
  let settled = false;
  let timer = null;
  const finish = (val) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    try { if (!authWin.isDestroyed()) authWin.destroy(); } catch (e) { /* gone */ }
    resolve(val);
  };
  // The callback carries ?code=… ; grab it the instant the window heads there.
  const grab = (url) => {
    if (url && url.startsWith(CALLBACK) && url.includes("code=")) { finish(url); return true; }
    return false;
  };
  authWin.webContents.on("will-redirect", (e, url) => { if (grab(url)) e.preventDefault(); });
  authWin.webContents.on("will-navigate", (e, url) => { if (grab(url)) e.preventDefault(); });
  // The loopback load fails (nothing listening); its URL still carries the code.
  authWin.webContents.on("did-fail-load", (_e, _c, _d, url) => { grab(url); });
  authWin.on("closed", () => finish(null));  // user closed it before finishing
  timer = setTimeout(() => finish(null), 5 * 60 * 1000);
  // Present as plain Chrome (some providers reject an "Electron" UA on login).
  const ua = authWin.webContents.getUserAgent().replace(/ (Electron|schwab-trader-desktop)\/[^ ]+/gi, "");
  authWin.loadURL(authUrl, { userAgent: ua });
}));

// Exactly one instance: a second launch must not spawn a second sidecar against the
// same SQLite data dir (would fight over the file). Focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(async () => {
    PORT = await getFreePort();
    BASE = `http://localhost:${PORT}`;
    startBackend();
    waitForBackend(() => {
      createWindow();
      if (!isDev) {
        // Auto-update: check GitHub Releases, download in the background, install on quit.
        try {
          const { autoUpdater } = require("electron-updater");
          autoUpdater.checkForUpdatesAndNotify();
        } catch (e) { /* updater is a no-op in unsigned/dev contexts */ }
      }
    });
  });
}

function killBackend() {
  if (backend && !backend.killed) {
    try { backend.kill(); } catch (e) { /* already gone */ }
    backend = null;
  }
}

app.on("window-all-closed", () => { killBackend(); app.quit(); });
app.on("before-quit", killBackend);
process.on("exit", killBackend);
