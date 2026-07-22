import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./motion.css"; // motion tokens + keyframes — loaded first, never touched by a theme
import "./tokens.css";
import "./ui.css";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { ToastProvider } from "./Toast";
import { GlossaryProvider } from "./GlossaryUI";
import { applyFontSize, applyTheme, initThemeRuntime, storedChoice, storedFontSize, syncAppearanceFromServer } from "./theme";

// The <head> boot script already set data-theme + data-fontsize before first paint
// (no FOUC). Re-assert from the stored prefs (idempotent) and keep "Follow system" live.
applyTheme(storedChoice());
applyFontSize(storedFontSize());
initThemeRuntime();
// Then reconcile with the durable DB copy — localStorage resets each launch in the
// packaged app (new origin per port), so the server is the real source of truth.
syncAppearanceFromServer();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <GlossaryProvider>
          <App />
        </GlossaryProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
