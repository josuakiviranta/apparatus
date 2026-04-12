import { describe, it, expect, vi, beforeEach } from "vitest";
import { StoreHandler } from "./store.js";
import type { HandlerExecutionContext } from "./registry.js";
import type { Node, PipelineContext } from "../types.js";

vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import * as fsPromises from "fs/promises";

function makeCtx(values: Record<string, unknown> = {}): PipelineContext {
  return { values };
}

function makeContext(): HandlerExecutionContext {
  return { logsRoot: "/tmp", cwd: "/tmp", dotDir: "/tmp", outgoingLabels: [], completedNodes: [], nodeRetries: {} };
}

function makeNode(attrs: Partial<Node>): Node {
  return { id: "save", label: "save", ...attrs } as Node;
}

describe("StoreHandler", () => {
  const handler = new StoreHandler();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails when store_key attribute is missing", async () => {
    const outcome = await handler.execute(
      makeNode({ storeFile: "/out/file.md" }),
      makeCtx(),
      makeContext()
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toMatch(/store_key/);
  });

  it("fails when store_file attribute is missing", async () => {
    const outcome = await handler.execute(
      makeNode({ storeKey: "agent.output" }),
      makeCtx(),
      makeContext()
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toMatch(/store_file/);
  });

  it("fails when store_key value is not in context", async () => {
    const outcome = await handler.execute(
      makeNode({ storeKey: "missing.output", storeFile: "/out/file.md" }),
      makeCtx({}),
      makeContext()
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toMatch(/missing\.output/);
  });

  it("writes file and returns success with store.path", async () => {
    const outcome = await handler.execute(
      makeNode({ storeKey: "agent.output", storeFile: "/out/result.md" }),
      makeCtx({ "agent.output": "Hello world" }),
      makeContext()
    );
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["store.path"]).toBe("/out/result.md");
    expect(fsPromises.mkdir).toHaveBeenCalledWith("/out", { recursive: true });
    expect(fsPromises.writeFile).toHaveBeenCalledWith("/out/result.md", "Hello world", "utf8");
  });

  it("expands $variables in store_file from ctx.values", async () => {
    // Note: the regex matches $key.subkey as one token (for $nodename.output style).
    // File extensions must be part of the variable value, not appended after $var.
    const outcome = await handler.execute(
      makeNode({ storeKey: "agent.output", storeFile: "$dir/$filename" }),
      makeCtx({ "agent.output": "content", dir: "/output/jobs", filename: "acme-corp.md" }),
      makeContext()
    );
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["store.path"]).toBe("/output/jobs/acme-corp.md");
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      "/output/jobs/acme-corp.md",
      "content",
      "utf8"
    );
  });

  it("coerces non-string context values to string", async () => {
    const outcome = await handler.execute(
      makeNode({ storeKey: "score", storeFile: "/out/score.txt" }),
      makeCtx({ score: 42 }),
      makeContext()
    );
    expect(outcome.status).toBe("success");
    expect(fsPromises.writeFile).toHaveBeenCalledWith("/out/score.txt", "42", "utf8");
  });
});
