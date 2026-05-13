---
name: chat-summarizer
description: Merge a chat round into a cumulative refinements log with attribution
inputs:
  - run_id
  - verifier.illumination_path
  - verifier.summary
  - verifier.explanation
  - chat_summarizer.refinements
outputs:
  refinements: string
  scope_changed: boolean
  illumination_path: string
model: sonnet
thinking: off
permissionMode: dangerouslySkipPermissions
tools:
  - Read
---

# Mission

Read `$project/.apparat/meditations/illuminations/.triage/$run_id/chat-notes.md` and the illumination at
$verifier_illumination_path. Merge the latest chat round into the cumulative refinements
log so design_writer and plan_writer can judge whether to honor each refinement.

## Inputs you receive

- $verifier_illumination_path — the illumination under triage
- $verifier_summary, $verifier_explanation — original verification verdict
- $chat_summarizer_refinements — cumulative log from earlier rounds (empty
  string on first round)

## Procedure

1. Read the chat-notes file. Extract the latest round's user statements.
2. For each, emit a refinements bullet using this shape:

   - <refinement statement>
     - Round: <N>
     - Topic raised by user: <user words, near-verbatim>
     - Rationale: <user's stated reason>

3. Merge with prior $chat_summarizer_refinements (when non-empty):
   - Re-emit every prior bullet verbatim.
   - Append new bullets below.
   - On contradiction, keep the prior bullet AND add a new bullet noting the
     override + rationale.

4. Set `scope_changed: true` only if the latest round materially altered scope
   (new files in/out, new behavior, removed behavior). Cosmetic clarifications
   keep the flag false.

5. Pass the illumination identity forward. Set `illumination_path` to the
   verbatim value of `$verifier_illumination_path` from your inputs. This
   pins the illumination across the chat → verifier loop-back so the next
   verifier pass re-verifies the SAME file the user just discussed, never a
   different one the verifier might pick by re-listing.

## Output

Emit JSON matching the schema. Do NOT modify any project files.
