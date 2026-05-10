import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    env: {
      FORCE_COLOR: "0",
    },
  },
});
