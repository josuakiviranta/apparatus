import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { streamEvents, parseStreamJsonEvents } from "../lib/stream-formatter.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures", "classify-stream-replay.ndjson");
const expectedPath = join(here, "fixtures", "classify-stream-replay.expected.json");

const fixture = readFileSync(fixturePath, "utf8");
const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as {
  streamEvents: unknown[];
  streamJsonEvents: unknown[];
};

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("classify-stream replay (byte-identical invariant)", () => {
  it("streamEvents replay matches the frozen pre-rewire baseline", async () => {
    const got = await collect(streamEvents(Readable.from([fixture])));
    expect(got).toEqual(expected.streamEvents);
  });

  it("parseStreamJsonEvents replay matches the frozen pre-rewire baseline", async () => {
    const got = await collect(parseStreamJsonEvents(Readable.from([fixture])));
    expect(got).toEqual(expected.streamJsonEvents);
  });
});
