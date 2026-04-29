const RAW_TRUNCATE = 500;

export interface ValidationError {
  path: string;
  message: string;
}

export function buildCorrectiveMessage(
  rawOutput: string,
  errors: ValidationError[],
  schemaJsonString: string,
): string {
  const trimmed = rawOutput.trim();
  if (trimmed.length === 0) {
    return [
      "Your previous response had no text content — the response body was empty",
      "(possibly because the JSON ended up inside a thinking block).",
      "",
      "Required output schema:",
      schemaJsonString,
      "",
      "Re-emit your verdict NOW as a plain TEXT response. JSON only.",
      "Do NOT place the JSON inside a thinking block — emit as text content.",
    ].join("\n");
  }
  const truncated = rawOutput.length > RAW_TRUNCATE
    ? rawOutput.slice(0, RAW_TRUNCATE) + "..."
    : rawOutput;
  const errorBullets = errors
    .map(e => `  • ${e.path || "(root)"}: ${e.message}`)
    .join("\n");
  return [
    "Your previous response failed schema validation:",
    errorBullets,
    "",
    "Your previous raw response (first 500 chars):",
    "<<<",
    truncated,
    ">>>",
    "",
    "Required output schema:",
    schemaJsonString,
    "",
    "Re-emit valid JSON matching the schema. Plain TEXT response, no thinking block, no markdown fences.",
  ].join("\n");
}
