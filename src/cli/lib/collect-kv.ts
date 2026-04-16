/**
 * Accumulator for commander `.option(..., collectKV, {})`.
 * Splits on the first `=`. Throws on missing `=` or empty key.
 * Later occurrences of the same key overwrite earlier values.
 */
export function collectKV(
  raw: string,
  acc: Record<string, string>,
): Record<string, string> {
  const idx = raw.indexOf("=");
  if (idx === -1) {
    throw new Error(`--var "${raw}" expected key=value`);
  }
  const key = raw.slice(0, idx).trim();
  const value = raw.slice(idx + 1);
  if (!key) {
    throw new Error(`--var "${raw}" has empty key`);
  }
  acc[key] = value;
  return acc;
}
