jest.mock("obsidian", () => ({ Platform: { isMobile: false } }));

import { EventEmitter } from "node:events";
import { installRendererEventsShim } from "./rendererEventsShim";

const obsidian: { Platform: { isMobile: boolean } } = jest.requireMock("obsidian");

describe("installRendererEventsShim", () => {
  let original: typeof EventEmitter.setMaxListeners;

  beforeEach(() => {
    original = EventEmitter.setMaxListeners;
    obsidian.Platform.isMobile = false;
  });

  afterEach(() => {
    EventEmitter.setMaxListeners = original;
  });

  it("is a no-op on mobile — never touches EventEmitter", () => {
    // The whole point of the #125 fix: on mobile node:events is undefined, so
    // the shim must not reference EventEmitter at all. Guard returns first.
    obsidian.Platform.isMobile = true;
    installRendererEventsShim();
    expect(EventEmitter.setMaxListeners).toBe(original);
  });

  it("has no load-time side effect — patching only happens when called", () => {
    // Importing the module above must not have patched anything on its own.
    expect(EventEmitter.setMaxListeners).toBe(original);
  });

  it("on desktop, swallows setMaxListeners misuse with AbortSignal-shaped targets", () => {
    installRendererEventsShim();
    const signalLike = { aborted: false, dispatchEvent: () => true };
    // Node's setMaxListeners rejects a non-EventTarget target; the shim drops
    // that throw only for AbortSignal-shaped targets.
    expect(() => EventEmitter.setMaxListeners(5, signalLike as never)).not.toThrow();
  });

  it("on desktop, still throws for unrelated misuse", () => {
    installRendererEventsShim();
    expect(() => EventEmitter.setMaxListeners(5, {} as never)).toThrow();
  });

  it("is idempotent — re-applying does not double-wrap", () => {
    installRendererEventsShim();
    const afterFirst = EventEmitter.setMaxListeners;
    installRendererEventsShim();
    expect(EventEmitter.setMaxListeners).toBe(afterFirst);
  });
});
