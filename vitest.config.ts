import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",
    env: {
      FORCE_COLOR: "0",
    },
  },
});
