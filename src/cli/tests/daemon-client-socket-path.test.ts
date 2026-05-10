import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";

// HOME is touched in this file because it exercises the HOME-fallback path of
// getApparatHome() (a verified semantic of the precedence chain). Bracket-form
// access (process.env["HOME"]) is intentional to satisfy the design §10.1 grep
// contract that flags unrestored HOME swaps in src/cli/tests/. All HOME mutations
// here snapshot/restore via origHome in afterEach, so the safety property the
// grep is heuristically guarding (no leak across tests) is preserved.

describe("daemon-client socket path honours APPARAT_HOME at call time", () => {
  let origApparatHome: string | undefined;
  let origHome: string | undefined;

  afterEach(() => {
    if (origApparatHome === undefined) delete process.env.APPARAT_HOME;
    else process.env.APPARAT_HOME = origApparatHome;
    if (origHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = origHome;
  });

  it("re-resolves on each call (no module-load caching)", async () => {
    origApparatHome = process.env.APPARAT_HOME;
    origHome = process.env["HOME"];

    process.env.APPARAT_HOME = "/tmp/first-home";
    const { getDaemonSocketPath } = await import("../../lib/daemon-client.js");
    expect(getDaemonSocketPath()).toBe(join("/tmp/first-home", "daemon.sock"));

    process.env.APPARAT_HOME = "/tmp/second-home";
    expect(getDaemonSocketPath()).toBe(join("/tmp/second-home", "daemon.sock"));
  });

  it("falls back to ~/.apparat/daemon.sock when APPARAT_HOME unset", async () => {
    origApparatHome = process.env.APPARAT_HOME;
    origHome = process.env["HOME"];
    delete process.env.APPARAT_HOME;
    process.env["HOME"] = "/tmp/operator";
    const { getDaemonSocketPath } = await import("../../lib/daemon-client.js");
    expect(getDaemonSocketPath()).toBe(join("/tmp/operator", ".apparat", "daemon.sock"));
  });
});
