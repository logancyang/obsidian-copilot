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
      expect(overlay.show).toHaveBeenCalledTimes(1);
      expect(png).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("leaves Settings alone when the pane is in another window", async () => {
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
      expect(overlay.show).toHaveBeenCalledTimes(1);
    });

    it("puts the dialog back when the capture itself fails", async () => {
      const win = windowStub();
      const overlay = elementIn(win);
      captureViewScreenshot.mockRejectedValue(new Error("capturePage failed"));

      await expect(captureBehindOverlay(overlay, () => elementIn(win), jest.fn())).rejects.toThrow(
        "capturePage failed"
      );

      expect(overlay.show).toHaveBeenCalledTimes(1);
    });
  });

  describe("waitForStableTarget()", () => {
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

    const advance = async (samples: number) => {
      for (let i = 0; i < samples; i++) {
        await jest.advanceTimersByTimeAsync(50);
      }
    };

    it("settles once the whole rect repeats", async () => {
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
      const { el } = targetEl([
        { left: 900, top: 0, width: 300, height: 400 },
        { left: 700, top: 0, width: 300, height: 400 },
        { left: 500, top: 0, width: 300, height: 400 },
        { left: 400, top: 0, width: 300, height: 400 },
        { left: 400, top: 0, width: 300, height: 400 },
      ]);

      const state = watch(waitForStableTarget(el));
      await advance(3);

      expect(state.settled).toBe(false);

      await advance(2);
      expect(state.value).toBe(true);
    });

    it("gives up as soon as the element leaves the document", async () => {
      const { el } = targetEl([{ left: 0, top: 0, width: 300, height: 400 }], false);

      const settled = waitForStableTarget(el);
      await advance(1);

      expect(await settled).toBe(false);
    });

    it("stops waiting on an element that never gains a size", async () => {
      const { el } = targetEl([{ left: 0, top: 0, width: 0, height: 0 }]);

      const settled = waitForStableTarget(el);
      await advance(30);

      expect(await settled).toBe(false);
    });

    it("finishes on its deadline even when frame callbacks never fire", async () => {
      const { el } = targetEl([{ left: 0, top: 0, width: 0, height: 0 }]);

      const settled = waitForStableTarget(el);
      await advance(30);

      expect(await settled).toBe(false);
    });
  });
});
