const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Ad-hoc code-sign the macOS .app so an UNSIGNED build still launches on Apple Silicon.
// With NO signature at all, arm64 macOS refuses the app as "damaged" (the dialog offers
// only Move to Trash / Cancel — not even Open Anyway). electron-builder SKIPS signing when
// no Developer ID cert is present (confirmed in CI logs), so we apply the ad-hoc signature
// ourselves here — afterPack runs once the .app is assembled, before the .dmg is built.
//
// This does NOT notarize: the first launch still needs a right-click -> Open (the normal,
// bypassable Gatekeeper prompt). Removing even that requires the paid Apple cert. On
// Windows/Linux this hook is a no-op.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const dir = context.appOutDir;
  const appName = fs.readdirSync(dir).find((f) => f.endsWith(".app"));
  if (!appName) return;
  const appPath = path.join(dir, appName);
  // --deep so the bundled Electron frameworks + the PyInstaller backend sidecar inside
  // Resources are all ad-hoc signed too (inner-to-outer); "-" is the ad-hoc identity.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  console.log(`afterPack: ad-hoc signed ${appName}`);
};
