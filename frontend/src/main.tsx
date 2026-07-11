import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./motion.css"; // motion tokens + keyframes — loaded first, never touched by a theme
import "./tokens.css";
import "./ui.css";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { ToastProvider } from "./Toast";
import { applyFontSize, applyTheme, initThemeRuntime, storedChoice, storedFontSize } from "./theme";

// The <head> boot script already set data-theme + data-fontsize before first paint
// (no FOUC). Re-assert from the stored prefs (idempotent) and keep "Follow system" live.
applyTheme(storedChoice());
applyFontSize(storedFontSize());
initThemeRuntime();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
