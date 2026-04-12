/**
 * Parse structured output that may be a JSON array, single JSON object,
 * or newline-delimited JSON (NDJSON). Non-JSON lines are silently skipped.
 */
export function parseStructuredOutput(rawText: string): unknown[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // Try parsing as a single JSON value (array or object)
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Fall through to NDJSON parsing
  }

  // Parse as NDJSON — one JSON object per line, skip non-JSON lines
  const results: unknown[] = [];
  for (const line of trimmed.split("\n")) {
    const stripped = line.trim();
    if (!stripped) continue;
    try {
      results.push(JSON.parse(stripped));
    } catch {
      // skip non-JSON lines
    }
  }
  return results;
}
