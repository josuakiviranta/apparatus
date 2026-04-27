---
type: gate
choices:
  - Commit
  - Retry
inputs:
  - run_id
  - test_render
---
Tests ran in tmux window test-$run_id.

$test_render

Commit the fixes or give tmux-tester another pass?
