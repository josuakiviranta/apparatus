import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { StoreHandler } from "../handlers/store.js";
import type { HandlerExecutionContext } from "../handlers/registry.js";
import type { Node, PipelineContext } from "../types.js";

function makeContext(): HandlerExecutionContext {
  return { logsRoot: "/tmp", cwd: "/tmp", dotDir: "/tmp", outgoingLabels: [], completedNodes: [], nodeRetries: {} };
}

describe("StoreHandler", () => {
  let tmp: string;
  const handler = new StoreHandler();

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "store-test-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("fails when store_key attribute is missing", async () => {
    const node: Node = { id: "s", shape: "cylinder", storeFile: "/tmp/out.md" };
    const ctx: PipelineContext = { values: {} };
    const outcome = await handler.execute(node, ctx, makeContext());
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("store_key attribute required");
  });

  it("fails when store_file attribute is missing", async () => {
    const node: Node = { id: "s", shape: "cylinder", storeKey: "data" };
    const ctx: PipelineContext = { values: {} };
    const outcome = await handler.execute(node, ctx, makeContext());
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("store_file attribute required");
  });

  it("fails when store_key is not found in context", async () => {
    const node: Node = { id: "s", shape: "cylinder", storeKey: "missing.key", storeFile: join(tmp, "out.md") };
    const ctx: PipelineContext = { values: {} };
    const outcome = await handler.execute(node, ctx, makeContext());
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("store_key 'missing.key' not found in context");
  });

  it("writes string value to file and returns store.path", async () => {
    const outPath = join(tmp, "output.md");
    const node: Node = { id: "s", shape: "cylinder", storeKey: "humanize.output", storeFile: outPath };
    const ctx: PipelineContext = { values: { "humanize.output": "# Hello World" } };
    const outcome = await handler.execute(node, ctx, makeContext());
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["store.path"]).toBe(outPath);
    const written = await readFile(outPath, "utf8");
    expect(written).toBe("# Hello World");
  });

  it("creates parent directories recursively", async () => {
    const outPath = join(tmp, "deep", "nested", "dir", "out.md");
    const node: Node = { id: "s", shape: "cylinder", storeKey: "data", storeFile: outPath };
    const ctx: PipelineContext = { values: { data: "content" } };
    const outcome = await handler.execute(node, ctx, makeContext());
    expect(outcome.status).toBe("success");
    const written = await readFile(outPath, "utf8");
    expect(written).toBe("content");
  });

  it("expands variables in store_file path", async () => {
    const node: Node = { id: "s", shape: "cylinder", storeKey: "data", storeFile: "$output_dir/result.md" };
    const ctx: PipelineContext = { values: { data: "expanded content", output_dir: tmp } };
    const outcome = await handler.execute(node, ctx, makeContext());
    expect(outcome.status).toBe("success");
    const expectedPath = join(tmp, "result.md");
    expect(outcome.contextUpdates?.["store.path"]).toBe(expectedPath);
    const written = await readFile(expectedPath, "utf8");
    expect(written).toBe("expanded content");
  });

  it("JSON-stringifies non-string values", async () => {
    const outPath = join(tmp, "obj.json");
    const node: Node = { id: "s", shape: "cylinder", storeKey: "data", storeFile: outPath };
    const ctx: PipelineContext = { values: { data: { key: "value", count: 42 } } };
    const outcome = await handler.execute(node, ctx, makeContext());
    expect(outcome.status).toBe("success");
    const written = await readFile(outPath, "utf8");
    expect(JSON.parse(written)).toEqual({ key: "value", count: 42 });
  });
});
