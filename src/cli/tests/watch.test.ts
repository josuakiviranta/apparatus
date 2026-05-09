import { describe, it, expect, vi } from "vitest";

// Mock WatchApp BEFORE the static import inside HeartbeatWatch resolves.
// The path MUST match the import string in HeartbeatWatch.tsx ("./WatchApp.js").
// Relative to this test file at src/cli/tests/watch.test.ts → "../components/WatchApp.js"
vi.mock("../components/WatchApp.js", () => ({
  renderWatchApp: vi.fn().mockResolvedValue(undefined),
}));

import { renderWatch } from "../components/HeartbeatWatch.js";
import { renderWatchApp } from "../components/WatchApp.js";

describe("`heartbeat watch` deprecation alias", () => {
  it("prints a deprecation notice to stderr and forwards to renderWatchApp", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await renderWatch();
    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrCalls).toContain("`heartbeat watch` is deprecated");
    expect(renderWatchApp).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});
