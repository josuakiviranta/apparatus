---
type: gate
choices:
  - Commit
  - Retry
inputs:
  - run_id
  - tmux_tester.test_render
---
Tests ran in tmux window test-$run_id.

$tmux_tester.test_render

Commit the fixes or give tmux-tester another pass?
