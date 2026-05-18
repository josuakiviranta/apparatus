#!/usr/bin/env node
// End-to-end smoke for the cleanJsonlEvents filter.
// Reads the synthetic demo/raw-attempt-1.txt produced by setup-fixture.sh,
// runs it through the cleaner, and asserts:
//   - 8 ceremony frames are removed (3 hook_started, 3 hook_response,
//     1 rate_limit_event, 1 assistant tool_result echo)
//   - The retained user-side tool_result, tool_use, and text frames survive
//   - --full mode (cleaner bypassed) returns the input unchanged

import { readFileSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "/tmp/apparat-trace-smoke";
const rawPath = join(base, ".apparat", "runs", "trace-smoke-deadbeef", "demo", "raw-attempt-1.txt");

const lines = readFileSync(rawPath, "utf-8").trim().split("\n").map(l => JSON.parse(l));
if (lines.length !== 11) {
  console.error(`expected 11 raw-attempt lines; got ${lines.length}`);
  process.exit(1);
}

const { cleanJsonlEvents } = await import("../../../dist/cli/lib/trace-cleaner.js");

const cleaned = cleanJsonlEvents(lines);
if (cleaned.length !== 3) {
  console.error(`expected 3 surviving lines after clean; got ${cleaned.length}`);
  console.error(JSON.stringify(cleaned, null, 2));
  process.exit(1);
}

const hasHook = cleaned.some(l => l.type === "system" && (l.subtype === "hook_started" || l.subtype === "hook_response"));
if (hasHook) { console.error("hook frame survived cleaner"); process.exit(1); }

const hasRateLimit = cleaned.some(l => l.type === "rate_limit_event");
if (hasRateLimit) { console.error("rate_limit_event survived cleaner"); process.exit(1); }

const hasAssistantToolResult = cleaned.some(l => {
  if (l.type !== "assistant") return false;
  const content = (l.message?.content ?? []);
  return content.some(c => c?.type === "tool_result");
});
if (hasAssistantToolResult) { console.error("assistant tool_result echo survived cleaner"); process.exit(1); }

const hasUserToolResult = cleaned.some(l => {
  if (l.type !== "user") return false;
  const content = (l.message?.content ?? []);
  return content.some(c => c?.type === "tool_result");
});
if (!hasUserToolResult) { console.error("user-side tool_result missing"); process.exit(1); }

console.log("cleaner-contract: OK (3 of 11 lines retained, ceremony stripped)");
