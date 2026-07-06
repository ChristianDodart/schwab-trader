// Single source of truth for the backend base URL.
//
// DEV (Vite on :5173): talk cross-origin to the backend on :8000 (CORS-allowed).
// PROD (packaged desktop): the backend serves this SPA SAME-ORIGIN on whatever port
// Electron picked, so use RELATIVE URLs — no hardcoded port, no CORS.
const DEV = import.meta.env.DEV;

export const API = DEV ? "http://localhost:8000/api" : "/api";

export const wsUrl = (path: string): string => {
  if (DEV) return `ws://localhost:8000${path}`;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${path}`;
};
