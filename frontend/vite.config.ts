import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // fs.allow includes the repo root so `../CHANGELOG.md?raw` (the single source of patch
  // notes, shared with the GitHub release body) imports cleanly in dev + build.
  server: { port: 5173, fs: { allow: [".."] } },
  build: {
    rollupOptions: {
      output: {
        // Split heavy/rarely-changing deps into their own chunks so the main bundle
        // shrinks under the 500 kB warning and browser caching is more effective.
        manualChunks: {
          charts: ["lightweight-charts"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
