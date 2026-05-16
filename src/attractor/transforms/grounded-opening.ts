/**
 * Canonical orientation block appended to every interactive agent's prompt.
 * Engine-level injection: `buildAgentPrompt` at agent-prep.ts:115 concatenates
 * this when isInteractiveAgent(node) is true.
 *
 * Same wording for every interactive node — the format is also enumerated in
 * each agent .md so the file reads correctly out of context (apparat pipeline
 * explain), but the prompt-bytes truth lives here.
 */
export const GROUNDED_OPENING_BLOCK = `## Grounded opening (mandatory)

Before your first user-facing message:

1. **Restate every injected value.** For each tag in the Inputs block above,
   write one line: \`- <tag>: <one-sentence summary>\`. If a value is a file
   path, also state the basename.
2. **Read every path you were handed.** For each path-shaped injected value,
   open the file with the Read tool and quote at least one line that grounds
   the rest of your turn. State "file:line" for every quote.
3. **Open with three labelled sections, then your first question.**

   \`\`\`
   ## Here is what I can see
   - <one line per injected value>

   ## Here is what I read in the code
   - <file:line> — "<quoted line>"

   ## Here is what I am inferring (unverified)
   - <inference> — guessed from <input or quote>

   ## My first question is
   <one question>
   \`\`\`

**Hard rule:** Never claim anything about the codebase without citing
\`file:line\`. If you have not read it, say "I have not read this yet" and
read it before your next claim.
`;
