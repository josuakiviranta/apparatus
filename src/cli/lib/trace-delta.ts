const STRING_TRUNCATE = 80;

function renderValue(v: unknown): string {
  if (typeof v === "string") {
    const escaped = JSON.stringify(v).slice(1, -1);
    if (escaped.length > STRING_TRUNCATE) {
      return `"${escaped.slice(0, STRING_TRUNCATE)}…"`;
    }
    return `"${escaped}"`;
  }
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return `<array len=${v.length}>`;
  if (typeof v === "object") return "<object>";
  return String(v);
}

export function renderContextDelta(
  contextUpdates: Record<string, unknown>,
  prev?: Record<string, unknown>,
): string {
  const parts: string[] = [];
  for (const k of Object.keys(contextUpdates)) {
    const next = contextUpdates[k];
    if (prev && Object.prototype.hasOwnProperty.call(prev, k)) {
      parts.push(`~ ${k}=${renderValue(prev[k])}→${renderValue(next)}`);
    } else {
      parts.push(`+ ${k}=${renderValue(next)}`);
    }
  }
  if (prev) {
    for (const k of Object.keys(prev)) {
      if (!Object.prototype.hasOwnProperty.call(contextUpdates, k)) {
        parts.push(`- ${k}`);
      }
    }
  }
  return parts.join("  ");
}
