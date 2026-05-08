---
type: gate
choices:
  - Commit
  - Retry
inputs:
  - run_id
  - implement.done
  - implement.reason
  - tmux_tester.test_result
  - tmux_tester.test_render
  - tmux_tester.plan_files_touched
---
Tests ran in tmux window test-$run_id.

### Signals
- implement.done: $implement.done   (reason: $implement.reason)
- tmux_tester.test_result: $tmux_tester.test_result
- tmux_tester.plan_files_touched: $tmux_tester.plan_files_touched

$tmux_tester.test_render

Commit the fixes or give tmux-tester another pass?
