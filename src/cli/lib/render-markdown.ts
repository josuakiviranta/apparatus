import { marked, type MarkedExtension } from "marked";
import { markedTerminal } from "marked-terminal";

// marked-terminal's return type doesn't satisfy MarkedExtension structurally (upstream type mismatch)
marked.use(markedTerminal({ showSectionPrefix: false }) as unknown as MarkedExtension);

export function renderMarkdown(text: string): string {
  return (marked(text) as string).trimEnd();
}
