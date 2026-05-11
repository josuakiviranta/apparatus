/**
 * Wrap a string in POSIX-safe single quotes. Embedded single quotes are
 * escaped via the canonical `'\''` pattern. Always-quote — uniform output
 * is simpler than a "needs quoting?" heuristic and survives bash/zsh/sh
 * round-trips identically. Used by the failure-footer resume recipe and
 * the tool-handler script-file interpreter.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
