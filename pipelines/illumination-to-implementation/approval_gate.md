---
type: gate
choices:
  - Decline
  - Approve
  - Chat
inputs:
  - illumination_path
  - summary
  - explanation
  - explainer_render
  - refinements
---
Proceed with plan?

Illumination: $illumination_path
Summary: $summary
Verifier: $explanation

$explainer_render

Refinements (cumulative; empty on first entry):
$refinements
