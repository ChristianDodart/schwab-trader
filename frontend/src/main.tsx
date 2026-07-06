import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./tokens.css";
import "./ui.css";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { ToastProvider } from "./Toast";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
