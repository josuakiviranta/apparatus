// src/cli/lib/interactions/driver.ts
import type { InteractionKind } from "../classifyNode.js";
import type { LiveBlock, Block, Outcome } from "../pipelineEvents.js";
import type { ChildHandle } from "../agent.js";
import type { ReactNode } from "react";

export type DriverPayload =
  | {
      driver: "interactive-agent";
      kind: "agent.ready";
      child: ChildHandle;
      onDone: () => void;
    }
  | {
      driver: "wait-human";
      kind: "gate.ready";
      options: string[];
      onChoose: (choice: string) => void;
    };

export interface DriverRenderCtx {
  inputBuffer: string;
  onInputChange: (v: string) => void;
  onInputSubmit: (v: string) => Promise<void>;
}

export interface InteractionDriver<K extends InteractionKind> {
  readonly kind: K;
  initState(block: LiveBlock): unknown;
  reduce(payload: DriverPayload, state: LiveBlock): LiveBlock;
  renderFooter(block: LiveBlock, ctx: DriverRenderCtx): ReactNode;
  keymap: {
    escape: (block: LiveBlock) => void;
    help?: string;
  };
  onFreeze?(live: LiveBlock, outcome: Outcome): Partial<Block>;
}
