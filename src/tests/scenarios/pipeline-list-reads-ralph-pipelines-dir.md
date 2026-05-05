# Scenario: `ralph pipeline list` reads workflows from `.apparat/pipelines/`

## Setup
- `mkdir -p list-smoke`
- `ralph init list-smoke`
- Write a minimal smoke pipeline to `list-smoke/.apparat/pipelines/hello.dot` with content:
  ```
  digraph hello {
    goal="smoke pipeline for list test"
    start [shape=Mdiamond]
    done  [shape=Msquare]
    start -> done
  }
  ```

## Action
`ralph pipeline list --project list-smoke`

## Expect
- exit code is 0
- stdout contains the substring `hello`
- stdout contains the substring `smoke pipeline for list test`
- stdout contains the substring `list-smoke/.apparat/pipelines`
