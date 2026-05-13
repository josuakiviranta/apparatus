---
model: sonnet
thinking: off
type: gate
choices:
  - Archive
  - Keep
  - Chat
inputs:
  - verifier.illumination_path
  - verifier.explanation
---
Verifier recommends archiving.

$verifier.illumination_path

Reason: $verifier.explanation

Choose: Archive (agree), Keep (override), or Chat (discuss).
