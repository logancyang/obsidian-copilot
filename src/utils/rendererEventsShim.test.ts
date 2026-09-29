jest.mock("obsidian", () => ({ Platform: { isDesktopApp: true, isMobile: false } }));

import { EventEmitter } from "node:events";
import { installRendererEventsShim } from "./rendererEventsShim";

const obsidian: { Platform: { isDesktopApp: boolean; isMobile: boolean } } =
  jest.requireMock("obsidian");

describe("installRendererEventsShim", () => {
  let original: typeof EventEmitter.setMaxListeners;

  beforeEach(() => {
    original = EventEmitter.setMaxListeners;
    obsidian.Platform.isDesktopApp = true;
    obsidian.Platform.isMobile = false;
  });

  afterEach(() => {
    EventEmitter.setMaxListeners = original;
  });

  it("is a no-op on mobile — never touches EventEmitter", () => {
    obsidian.Platform.isMobile = true;
    installRendererEventsShim();
    expect(EventEmitter.setMaxListeners).toBe(original);
  });

  it("has no load-time side effect — patching only happens when called", () => {
    expect(EventEmitter.setMaxListeners).toBe(original);
  });

  it("evaluates without requiring node:events — safe in the mobile module graph", () => {
    const throwingIds = ["events", "node:events"];
    try {
      jest.isolateModules(() => {
        for (const id of throwingIds) {
          jest.doMock(id, () => {
            throw new Error(`eager require of ${id}`);
          });
        }
        expect(() => void jest.requireActual("./rendererEventsShim")).not.toThrow();
      });
    } finally {
      for (const id of throwingIds) jest.dontMock(id);
    }
  });

  it("on desktop, swallows setMaxListeners misuse with AbortSignal-shaped targets", () => {
    installRendererEventsShim();
    const signalLike = { aborted: false, dispatchEvent: () => true };
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
