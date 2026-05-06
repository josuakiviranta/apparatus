// src/cli/commands/pipeline.ts
//
// Barrel re-export. Implementation lives under ./pipeline/ and in
// ./pipeline-invocation.ts. This file exists to preserve import paths
// for the existing test files and the sibling commands that import
// from it (implement.ts, meditate.ts).

export { pipelineRunCommand } from "./pipeline/run.js";
export type { PipelineRunOptions } from "./pipeline/run.js";
export { pipelineValidateCommand, diffEdgeLabels } from "./pipeline/validate.js";
export type { PipelineValidateOptions } from "./pipeline/validate.js";
export { pipelineShowCommand } from "./pipeline/show.js";
export type { PipelineShowOptions } from "./pipeline/show.js";
export { pipelineListCommand } from "./pipeline/list.js";
export type { PipelineListOptions } from "./pipeline/list.js";
export { pipelineTraceCommand } from "./pipeline/trace.js";
export { gcOldRuns, resolveResumeLogsRoot } from "./pipeline/runs-gc.js";
