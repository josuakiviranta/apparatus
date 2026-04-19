import { describe, it, expect } from "vitest";
import { BaseNodeSchema } from "../core/schemas.js";

describe("BaseNodeSchema", () => {
  it("accepts a node with only id", () => {
    const result = BaseNodeSchema.safeParse({ id: "n1" });
    expect(result.success).toBe(true);
  });

  it("rejects unknown attributes", () => {
    const result = BaseNodeSchema.safeParse({ id: "n1", tool_commnd: "x" });
    expect(result.success).toBe(false);
  });
});
