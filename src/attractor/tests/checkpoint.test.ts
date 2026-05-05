import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveCheckpoint, loadCheckpoint } from "../checkpoint.js";
import type { CheckpointState } from "../types.js";

describe("checkpoint", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "apparat-test-")); });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  const state: CheckpointState = {
    timestamp: "2026-04-08T12:00:00Z",
    currentNode: "implement",
    completedNodes: ["start", "meditate"],
    nodeRetries: { implement: 1 },
    context: { "meditate.sessionId": "abc123" },
  };

  it("saves and loads checkpoint", async () => {
    await saveCheckpoint(dir, state);
    const loaded = await loadCheckpoint(dir);
    expect(loaded).toMatchObject(state);
  });

  it("returns null when no checkpoint exists", async () => {
    const loaded = await loadCheckpoint(dir);
    expect(loaded).toBeNull();
  });

  it("overwrites existing checkpoint on save", async () => {
    await saveCheckpoint(dir, state);
    const updated = { ...state, currentNode: "scenarios" };
    await saveCheckpoint(dir, updated);
    const loaded = await loadCheckpoint(dir);
    expect(loaded?.currentNode).toBe("scenarios");
  });

  it("preserves numbers, booleans, and nested objects in context", async () => {
    const richState: CheckpointState = {
      timestamp: "2026-04-13T00:00:00.000Z",
      currentNode: "n1",
      completedNodes: ["start"],
      nodeRetries: {},
      context: {
        "chat.turnsUsed": 7,
        "chat.success": true,
        "chat.digest": { messageCount: 14, usage: { inputTokens: 100, outputTokens: 50 }, tools: [] },
        "chat.output": "plain string",
      },
    };
    await saveCheckpoint(dir, richState);
    const loaded = await loadCheckpoint(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.context["chat.turnsUsed"]).toBe(7);
    expect(loaded!.context["chat.success"]).toBe(true);
    expect(loaded!.context["chat.digest"]).toEqual({
      messageCount: 14,
      usage: { inputTokens: 100, outputTokens: 50 },
      tools: [],
    });
    expect(loaded!.context["chat.output"]).toBe("plain string");
  });
});
