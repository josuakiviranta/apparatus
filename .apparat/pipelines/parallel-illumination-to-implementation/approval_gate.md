---
model: sonnet
thinking: off
type: gate
choices:
  - Decline
  - Approve
  - Chat
inputs:
  - verifier.illumination_path
  - verifier.summary
  - verifier.explanation
  - explainer.explainer_render
  - chat_summarizer.refinements
---
Proceed with plan?

Illumination: $verifier.illumination_path
Summary: $verifier.summary
Verifier: $verifier.explanation

$explainer.explainer_render

Refinements (cumulative; empty on first entry):
$chat_summarizer.refinements
