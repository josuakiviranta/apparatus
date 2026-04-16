import { marked, type MarkedExtension } from "marked";
import { markedTerminal } from "marked-terminal";

marked.use(markedTerminal({ showSectionPrefix: false }) as unknown as MarkedExtension);

export function renderMarkdown(text: string): string {
  return (marked(text) as string).trimEnd();
}
