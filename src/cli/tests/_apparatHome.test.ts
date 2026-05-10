import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { withFakeApparatHome } from "./_apparatHome";

describe("withFakeApparatHome", () => {
  it("creates a scratch dir, sets APPARAT_HOME to it, and cleans up on cleanup()", () => {
    const origApparatHome = process.env.APPARAT_HOME;
    const fake = withFakeApparatHome();
    expect(existsSync(fake.path)).toBe(true);
    expect(process.env.APPARAT_HOME).toBe(fake.path);
    fake.cleanup();
    expect(existsSync(fake.path)).toBe(false);
    expect(process.env.APPARAT_HOME).toBe(origApparatHome);
  });

  it("restores APPARAT_HOME to undefined-via-delete when it was unset before", () => {
    delete process.env.APPARAT_HOME;
    const fake = withFakeApparatHome();
    expect(process.env.APPARAT_HOME).toBe(fake.path);
    fake.cleanup();
    expect(process.env.APPARAT_HOME).toBeUndefined();
    expect("APPARAT_HOME" in process.env).toBe(false);
  });

  it("restores APPARAT_HOME to its prior value when one was set", () => {
    process.env.APPARAT_HOME = "/tmp/preexisting";
    const fake = withFakeApparatHome();
    expect(process.env.APPARAT_HOME).toBe(fake.path);
    fake.cleanup();
    expect(process.env.APPARAT_HOME).toBe("/tmp/preexisting");
    delete process.env.APPARAT_HOME;
  });

  it("respects custom label prefix", () => {
    const fake = withFakeApparatHome("apparat-custom-label");
    expect(fake.path).toMatch(/apparat-custom-label-/);
    fake.cleanup();
  });
});
