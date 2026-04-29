import type { ZodObject, ZodTypeAny } from "zod";

export interface ValidationError { path: string; message: string }

export type EvaluationResult =
  | { ok: true; parsed: Record<string, unknown>; raw: string }
  | { ok: false; errors: ValidationError[]; raw: string };

/**
 * Inspect a buffered agent stdout (stream-json) and return either the parsed
 * structured result or a list of validation errors.
 *
 * Empty input → single "no text content" error (the verifier-style trap).
 * Schema validation runs only when zodSchema is non-null.
 */
export function evaluateAgentOutput(
  raw: string,
  zodSchema: ZodObject<Record<string, ZodTypeAny>> | null,
): EvaluationResult {
  if (!raw || raw.trim().length === 0) {
    return {
      ok: false,
      raw: "",
      errors: [{ path: "(root)", message: "no text content in response" }],
    };
  }
  // Normalise: if the raw output is a JSON array (e.g. from test mocks), convert
  // each element to an NDJSON line so extractResultPayload can process it.
  const normalised = normaliseRaw(raw);
  const extracted = extractResultPayload(normalised);
  // extracted === "" means a result event was found but it had empty content
  // (e.g. Claude emitted a thinking-block-only response). Treat as no-text-content.
  if (extracted === "") {
    return {
      ok: false,
      raw: "",
      errors: [{ path: "(root)", message: "no text content in response" }],
    };
  }
  const resultPayload = extracted ?? normalised;
  const jsonMatch = resultPayload.match(/\{"[\s\S]*\}/) ?? resultPayload.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : resultPayload;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return {
      ok: false,
      raw,
      errors: [{ path: "(root)", message: `JSON parse failed: ${(e as Error).message}` }],
    };
  }
  if (zodSchema) {
    const result = zodSchema.safeParse(parsed);
    if (!result.success) {
      return {
        ok: false,
        raw,
        errors: result.error.issues.map(i => ({
          path: i.path.length === 0 ? "(root)" : i.path.join("."),
          message: i.message,
        })),
      };
    }
    return { ok: true, parsed: result.data, raw };
  }
  return { ok: true, parsed, raw };
}

/**
 * If raw is a JSON array (e.g. from test mocks that return JSON.stringify([...])),
 * convert each element to an NDJSON line. Otherwise return raw unchanged.
 */
function normaliseRaw(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[")) return raw;
  try {
    const arr = JSON.parse(trimmed);
    if (Array.isArray(arr)) {
      return arr.map((item: unknown) => JSON.stringify(item)).join("\n");
    }
  } catch { /* not a JSON array — fall through */ }
  return raw;
}

function extractResultPayload(raw: string): string | undefined {
  let payload: string | undefined;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let evt: Record<string, unknown>;
    try { evt = JSON.parse(trimmed) as Record<string, unknown>; }
    catch { continue; }
    if (evt.type !== "result") continue;
    if (evt.structured_output != null) {
      payload = typeof evt.structured_output === "string"
        ? evt.structured_output
        : JSON.stringify(evt.structured_output);
    } else if (evt.result != null) {
      // Preserve empty string as "" so callers can distinguish "found empty result"
      // from "no result event found at all" (undefined).
      payload = typeof evt.result === "string"
        ? evt.result
        : JSON.stringify(evt.result);
    }
  }
  return payload;
}
