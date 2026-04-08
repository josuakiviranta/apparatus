import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import * as output from "../lib/output.js";

describe("output.step", () => {
  it("renders without throwing", async () => {
    await expect(output.step("Starting...")).resolves.toBeUndefined();
  });
});

describe("output.error", () => {
  it("renders without throwing", async () => {
    await expect(output.error("Something failed")).resolves.toBeUndefined();
  });
});

describe("output.spinner", () => {
  it("runs fn and resolves with its return value", async () => {
    const result = await output.spinner("working...", async () => "done");
    expect(result).toBe("done");
  });

  it("propagates errors thrown by fn", async () => {
    await expect(
      output.spinner("working...", async () => { throw new Error("boom"); })
    ).rejects.toThrow("boom");
  });
});

describe("output.stream", () => {
  it("consumes all events from the async iterable", async () => {
    async function* events() {
      yield { type: "main_agent_open" } as const;
      yield { type: "text", content: "Hello" } as const;
      yield { type: "main_agent_close" } as const;
    }
    await expect(output.stream(events())).resolves.toBeUndefined();
  });
});
