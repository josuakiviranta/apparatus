# ralph-cli Specs

Reference specifications for ralph-cli — an agentic loop runner for AI-assisted project development.

`ralph` is an npm CLI (`ralph-cli`) that orchestrates Claude Code sessions: running implementation loops, planning sessions, project scaffolding, meditation scripts, scenario testing, and background scheduling.

## Specification Index

| File | What it covers |
|------|---------------|
| [architecture.md](architecture.md) | Package structure, file layout, build entry points, asset bundling |
| [commands.md](commands.md) | All CLI commands — flags, behavior, error handling |
| [loop.md](loop.md) | Loop module — claude spawning, stream-formatter piping, git push, signal handling |
| [stream-formatter.md](stream-formatter.md) | stream-json → terminal output — subagent buffering, ctx growth gating |
| [meditate.md](meditate.md) | Meditation commands — persistent claude sessions with MCP write access |
| [run-scenarios.md](run-scenarios.md) | Scenario test discovery, execution, and report writing |
| [heartbeat.md](heartbeat.md) | Heartbeat scheduling — recurring tasks via background daemon |
| [daemon.md](daemon.md) | Daemon architecture — socket IPC, state, task runner |
| [mcp-illumination.md](mcp-illumination.md) | MCP illumination server — path-restricted write access for meditations |
| [pipeline.md](pipeline.md) | Pipeline subsystem — DOT graph engine, handlers, interviewer, checkpoint, tracer, diagnostics |
