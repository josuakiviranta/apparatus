import React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";

// Mock ChatUI to avoid nested <Static> which corrupts Ink's rendering.
// The real ChatUI uses <Static items={history}> internally; when that mounts
// and unmounts as a conditional child of PipelineDisplay's own <Static>,
// the parent Static stops rendering new items.  This mock renders a simple
// placeholder so we can test the overlay lifecycle without the Ink bug.
vi.mock("../components/ChatUI.js", () => ({
  ChatUI: function MockChatUI({ tracePath }: { tracePath?: string }) {
    return React.createElement(Text, null, `CHAT[${tracePath ?? ""}]`);
  },
}));

import {
  PipelineDisplay,
  type PipelineDisplayCallbacks,
  type ChatProps,
} from "../components/PipelineDisplay.js";
import { Session } from "../lib/session.js";
import { createFakeChildHandle } from "./helpers/fake-child-handle.js";

describe("PipelineDisplay interactive chat overlay", () => {
  it("shows chat, hides it on exit, and keeps rendering new lines afterwards", async () => {
    let cbs: PipelineDisplayCallbacks | null = null;

    const { lastFrame, unmount } = render(
      <PipelineDisplay
        pipelineName="test-pipeline"
        pid={1234}
        onReady={(callbacks) => {
          cbs = callbacks;
        }}
      />,
    );

    // Wait one microtask for useEffect to fire onReady
    await Promise.resolve();
    expect(cbs).not.toBeNull();

    // Push a line before chat starts
    cbs!.push({ kind: "info", text: "before-chat-line" });
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain("before-chat-line");

    // Mount chat overlay
    const session = new Session("test-session");
    const ctrl = createFakeChildHandle("test-session");
    const chatProps: ChatProps = {
      session,
      child: ctrl.handle,
      tracePath: "/tmp/trace/test-node",
      onExit: () => {},
    };
    cbs!.setChat(chatProps);

    // Give Ink a tick to re-render
    await new Promise((r) => setTimeout(r, 50));

    // Chat mock should appear with tracePath
    expect(lastFrame()).toContain("CHAT[/tmp/trace/test-node]");
    // Prior Static content is still there
    expect(lastFrame()).toContain("before-chat-line");

    // Close chat
    cbs!.setChat(null);

    // Give Ink a tick to re-render
    await new Promise((r) => setTimeout(r, 50));

    // Regression assertion: new pipeline output after chat ends MUST appear
    cbs!.push({ kind: "info", text: "after-chat-line" });

    // Give Ink a tick to re-render
    await new Promise((r) => setTimeout(r, 50));

    expect(lastFrame()).toContain("after-chat-line");
    // Old content persists
    expect(lastFrame()).toContain("before-chat-line");
    // Chat is gone
    expect(lastFrame()).not.toContain("CHAT[");

    unmount();
  });
});
