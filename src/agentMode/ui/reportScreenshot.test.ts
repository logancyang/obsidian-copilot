import { captureBehindOverlay, waitForStableTarget } from "@/agentMode/ui/reportScreenshot";

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

const captureViewScreenshot = jest.fn<Promise<Uint8Array>, [HTMLElement]>();

jest.mock("@/utils/captureViewScreenshot", () => ({
  captureViewScreenshot: (el: HTMLElement) => captureViewScreenshot(el),
}));

describe("reportScreenshot", () => {
  describe("captureBehindOverlay()", () => {
    /**
     * Overlay or pane, identified by which window object it carries. The window
     * also has to keep time, since the settle wait is clocked off the target's.
     */
    function windowStub() {
      return { setTimeout: (fn: () => void, ms?: number) => window.setTimeout(fn, ms) };
    }

    function elementIn(win: object, rect: Partial<DOMRect> = { width: 800, height: 600 }) {
      return {
        win,
        isConnected: true,
        hide: jest.fn(),
        show: jest.fn(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, ...rect }),
      } as unknown as HTMLElement & { hide: jest.Mock; show: jest.Mock };
    }

    beforeEach(() => {
      captureViewScreenshot.mockReset();
      captureViewScreenshot.mockResolvedValue(new Uint8Array([1, 2, 3]));
    });

    it("clears Settings out of the frame when it shares the pane's window", async () => {
      const win = windowStub();
      const overlay = elementIn(win);
      const dismissSettings = jest.fn();

      const png = await captureBehindOverlay(overlay, () => elementIn(win), dismissSettings);

      expect(dismissSettings).toHaveBeenCalledTimes(1);
      expect(overlay.hide).toHaveBeenCalledTimes(1);
      // Restored regardless: the flow continues in this dialog afterwards.
      expect(overlay.show).toHaveBeenCalledTimes(1);
      expect(png).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("leaves Settings alone when the pane is in another window", async () => {
      // Obsidian 1.13 gave Settings a window of its own, and this dialog opens
      // from there. Dismissing it would destroy the window running this very
      // code — the report would end here — to remove something no camera aimed
      // at the other window can see.
      const overlay = elementIn(windowStub());
      const dismissSettings = jest.fn();

      const png = await captureBehindOverlay(
        overlay,
        () => elementIn(windowStub()),
        dismissSettings
      );

      expect(dismissSettings).not.toHaveBeenCalled();
      expect(overlay.hide).not.toHaveBeenCalled();
      expect(png).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("skips the screenshot, and every dismissal, when there is no pane", async () => {
      const overlay = elementIn(windowStub());
      const dismissSettings = jest.fn();

      const png = await captureBehindOverlay(overlay, () => null, dismissSettings);

      expect(png).toBeNull();
      expect(dismissSettings).not.toHaveBeenCalled();
      expect(overlay.hide).not.toHaveBeenCalled();
      expect(captureViewScreenshot).not.toHaveBeenCalled();
    });

    it("hands back no screenshot rather than an unsettled one when the pane never stops moving", async () => {
      // Every sample reports a different box, so the wait runs out. Capturing
      // anyway would attach a picture of the pane mid-animation — cropped at an
      // offset it has already left — which is worse than no screenshot at all.
      const win = windowStub();
      const overlay = elementIn(win);
      let left = 0;
      const moving = {
        win,
        isConnected: true,
        getBoundingClientRect: () => ({ left: (left += 10), top: 0, width: 300, height: 400 }),
      } as unknown as HTMLElement;

      const png = await captureBehindOverlay(overlay, () => moving, jest.fn());

      expect(png).toBeNull();
      expect(captureViewScreenshot).not.toHaveBeenCalled();
      // The dialog still comes back: the flow carries on without the picture.
      expect(overlay.show).toHaveBeenCalledTimes(1);
    });

    it("puts the dialog back when the capture itself fails", async () => {
      const win = windowStub();
      const overlay = elementIn(win);
      captureViewScreenshot.mockRejectedValue(new Error("capturePage failed"));

      await expect(captureBehindOverlay(overlay, () => elementIn(win), jest.fn())).rejects.toThrow(
        "capturePage failed"
      );

      // Otherwise the user is left with a dismissed Settings window and an
      // invisible dialog holding the rest of the flow.
      expect(overlay.show).toHaveBeenCalledTimes(1);
    });
  });

  describe("waitForStableTarget()", () => {
    /**
     * Element whose measured rect the test drives outright, one sample per call.
     * `rects` is walked in order and the last entry repeats, so a case describes
     * an animation as the sequence of rects the pane reports while it plays.
     *
     * Carries its own `win`, because the pane can live in a popout while the
     * report dialog sits in the main renderer — the wait has to be clocked off
     * the element's window, not whichever one happens to be global.
     */
    function targetEl(rects: Array<Partial<DOMRect>>, connected = true) {
      let call = 0;
      const win = {
        setTimeout: (fn: () => void, ms?: number) => window.setTimeout(fn, ms),
        requestAnimationFrame: jest.fn(() => 1),
      };
      const el = {
        win,
        get isConnected() {
          return connected;
        },
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          ...rects[Math.min(call++, rects.length - 1)],
        }),
      } as unknown as HTMLElement;
      return { el, win };
    }

    /** Tracks settlement so a case can assert the wait has NOT finished yet. */
    function watch(promise: Promise<boolean>) {
      const state = { settled: false, value: undefined as boolean | undefined };
      void promise.then((value) => {
        state.settled = true;
        state.value = value;
      });
      return state;
    }

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    /** Advance far enough for the loop to take `samples` geometry readings. */
    const advance = async (samples: number) => {
      for (let i = 0; i < samples; i++) {
        await jest.advanceTimersByTimeAsync(50);
      }
    };

    it("settles once the whole rect repeats", async () => {
      // Mid-animation the pane is still growing, so an early sample must not be
      // trusted even though it already measures non-zero.
      const { el } = targetEl([
        { left: 0, top: 0, width: 0, height: 0 },
        { left: 400, top: 0, width: 120, height: 400 },
        { left: 400, top: 0, width: 300, height: 400 },
        { left: 400, top: 0, width: 300, height: 400 },
      ]);

      const settled = waitForStableTarget(el);
      await advance(4);

      expect(await settled).toBe(true);
    });

    it("keeps waiting while the pane slides at a fixed size", async () => {
      // The reveal animation stops resizing before it stops moving, and
      // `captureViewScreenshot` crops on left/top — so a size-only check would
      // photograph the pane mid-slide, offset from where it lands.
      const { el } = targetEl([
        { left: 900, top: 0, width: 300, height: 400 },
        { left: 700, top: 0, width: 300, height: 400 },
        { left: 500, top: 0, width: 300, height: 400 },
        { left: 400, top: 0, width: 300, height: 400 },
        { left: 400, top: 0, width: 300, height: 400 },
      ]);

      const state = watch(waitForStableTarget(el));
      await advance(3);

      // Three samples in, the size has never changed once — a loop comparing
      // only width and height would already have captured.
      expect(state.settled).toBe(false);

      await advance(2);
      expect(state.value).toBe(true);
    });

    it("gives up as soon as the element leaves the document", async () => {
      const { el } = targetEl([{ left: 0, top: 0, width: 300, height: 400 }], false);

      const settled = waitForStableTarget(el);
      await advance(1);

      // A detached pane can never be photographed, so this must not spend the
      // whole timeout before saying so.
      expect(await settled).toBe(false);
    });

    it("stops waiting on an element that never gains a size", async () => {
      const { el } = targetEl([{ left: 0, top: 0, width: 0, height: 0 }]);

      const settled = waitForStableTarget(el);
      // A collapsed pane would otherwise hold the whole report hostage.
      await advance(30);

      expect(await settled).toBe(false);
    });

    it("finishes on its deadline even when frame callbacks never fire", async () => {
      // A hidden window stops running `requestAnimationFrame` callbacks. The
      // pane can be revealed in a popout while this runs against a backgrounded
      // renderer, so a frame-driven wait would never reach its own deadline and
      // the report would hang with the dialog still hidden.
      // The stub hands back a handle and never runs the callback, so finishing
      // at all is the proof: an implementation may ask for frames, but it must
      // not depend on them arriving.
      const { el } = targetEl([{ left: 0, top: 0, width: 0, height: 0 }]);

      const settled = waitForStableTarget(el);
      await advance(30);

      expect(await settled).toBe(false);
    });
  });
});
