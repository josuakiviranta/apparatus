---
type: gate
choices:
  - Commit
  - Retry
inputs:
  - run_id
  - batch_orchestrator.done
  - batch_orchestrator.reason
  - tmux_tester.test_result
  - tmux_tester.test_render
  - tmux_tester.plan_files_touched
---
Tests ran in tmux window test-$run_id.

### Signals
- batch_orchestrator.done: $batch_orchestrator.done   (reason: $batch_orchestrator.reason)
- tmux_tester.test_result: $tmux_tester.test_result
- tmux_tester.plan_files_touched: $tmux_tester.plan_files_touched

$tmux_tester.test_render

Commit the fixes or give tmux-tester another pass?
