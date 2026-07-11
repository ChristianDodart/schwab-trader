import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./motion.css"; // motion tokens + keyframes — loaded first, never touched by a theme
import "./tokens.css";
import "./ui.css";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { ToastProvider } from "./Toast";
import { applyTheme, initThemeRuntime, storedChoice } from "./theme";

// The <head> boot script already set data-theme before first paint (no FOUC).
// Re-assert from the stored choice (idempotent) and keep "Follow system" live.
applyTheme(storedChoice());
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
