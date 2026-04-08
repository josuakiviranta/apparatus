import React from "react";
import { render } from "ink";
import {
  Step, Info, Warn, Error as ErrorComponent, Success,
  Header, SpinnerLine, StreamOutput,
} from "../components/ui.js";
import type { StreamEvent } from "./stream-formatter.js";

async function renderOnce(el: React.ReactElement): Promise<void> {
  const inst = render(el);
  // Give Ink one tick to flush the frame to stdout, then unmount.
  // One-shot components don't call exit(), so waitUntilExit() would hang.
  await new Promise(resolve => setTimeout(resolve, 0));
  inst.unmount();
}

export async function step(msg: string): Promise<void> {
  await renderOnce(React.createElement(Step, { text: msg }));
}

export async function info(msg: string): Promise<void> {
  await renderOnce(React.createElement(Info, { text: msg }));
}

export async function warn(msg: string): Promise<void> {
  await renderOnce(React.createElement(Warn, { text: msg }));
}

export async function error(msg: string): Promise<void> {
  await renderOnce(React.createElement(ErrorComponent, { text: msg }));
}

export async function success(msg: string): Promise<void> {
  await renderOnce(React.createElement(Success, { text: msg }));
}

export async function header(opts: {
  mode: string;
  project: string;
  branch?: string;
  pid?: number;
}): Promise<void> {
  await renderOnce(React.createElement(Header, opts));
}

export async function spinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let capturedResult: { ok: true; value: T } | { ok: false; error: unknown } | null = null;

  const trackingFn = async (): Promise<void> => {
    try {
      const value = await fn();
      capturedResult = { ok: true, value };
    } catch (err) {
      capturedResult = { ok: false, error: err };
      throw err;
    }
  };

  const { waitUntilExit } = render(
    React.createElement(SpinnerLine, { label, fn: trackingFn })
  );
  await waitUntilExit();

  const result = capturedResult as { ok: true; value: T } | { ok: false; error: unknown } | null;
  if (!result) throw new Error("spinner: fn never resolved");
  if (!result.ok) throw result.error;
  return result.value;
}

export async function stream(iter: AsyncIterable<StreamEvent>): Promise<void> {
  const { waitUntilExit } = render(
    React.createElement(StreamOutput, { iter })
  );
  await waitUntilExit();
}
