import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
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
