import { defineConfig } from "vitest/config";

// Pure-logic unit tests only (no DOM/component rendering) → the node environment is
// enough and fast. Tests live in src/*.test.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
