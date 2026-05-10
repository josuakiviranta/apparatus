import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";

describe("daemon-client socket path honours APPARAT_HOME at call time", () => {
  let origApparatHome: string | undefined;

  afterEach(() => {
    if (origApparatHome === undefined) delete process.env.APPARAT_HOME;
    else process.env.APPARAT_HOME = origApparatHome;
  });

  it("re-resolves on each call (no module-load caching)", async () => {
    origApparatHome = process.env.APPARAT_HOME;

    process.env.APPARAT_HOME = "/tmp/first-home";
    const { getDaemonSocketPath } = await import("../../lib/daemon-client.js");
    expect(getDaemonSocketPath()).toBe(join("/tmp/first-home", "daemon.sock"));

    process.env.APPARAT_HOME = "/tmp/second-home";
    expect(getDaemonSocketPath()).toBe(join("/tmp/second-home", "daemon.sock"));
  });

  it("falls back to ~/.apparat/daemon.sock when APPARAT_HOME unset", async () => {
    origApparatHome = process.env.APPARAT_HOME;
    delete process.env.APPARAT_HOME;
    process.env.HOME = "/tmp/operator";
    const { getDaemonSocketPath } = await import("../../lib/daemon-client.js");
    expect(getDaemonSocketPath()).toBe(join("/tmp/operator", ".apparat", "daemon.sock"));
  });
});
