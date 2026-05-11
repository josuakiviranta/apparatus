import { describe, it, expect, vi } from "vitest";
import { renderWatch } from "../components/HeartbeatWatch.js";

describe("`heartbeat watch` deprecation shim", () => {
  it("prints a deprecation notice pointing at `apparat status` and returns without rendering", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await renderWatch();
    const out = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("`heartbeat watch` is deprecated");
    expect(out).toContain("apparat status");
    stderrSpy.mockRestore();
  });
});
