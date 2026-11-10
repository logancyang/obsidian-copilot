import {
  shrinkToolImage,
  ToolImageThumbnails,
  type ToolImage,
} from "@/agentMode/session/toolImageThumbnails";
import type { AgentToolCallOutput } from "@/agentMode/session/types";

const CHART: ToolImage = { type: "image", mimeType: "image/png", data: "Q0hBUlQtZnVsbC1zaXpl" };
const DIAGRAM: ToolImage = {
  type: "image",
  mimeType: "image/png",
  data: "RElBR1JBTS1mdWxsLXNpemU=",
};
const SCREENSHOT: ToolImage = {
  type: "image",
  mimeType: "image/jpeg",
  data: "U0NSRUVOU0hPVC1mdWxs",
};
const CHART_THUMB: ToolImage = { type: "image", mimeType: "image/webp", data: "dGh1bWItY2hhcnQ=" };

interface PendingShrink {
  image: ToolImage;
  done: Promise<ToolImage>;
  resolve: (thumbnail: ToolImage) => void;
  reject: (error: Error) => void;
}

function controlledShrinker() {
  const started: PendingShrink[] = [];
  const shrink = (image: ToolImage) => {
    let resolve!: (thumbnail: ToolImage) => void;
    let reject!: (error: Error) => void;
    const done = new Promise<ToolImage>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    started.push({ image, done, resolve, reject });
    return done;
  };
  return { shrink, started };
}

function settleRecorder() {
  const settled: Array<{ key: string; thumbnail: ToolImage | null }> = [];
  let notify: () => void = () => undefined;
  const next = () => new Promise<void>((resolve) => (notify = resolve));
  const onSettle = (key: string, thumbnail: ToolImage | null) => {
    settled.push({ key, thumbnail });
    notify();
  };
  return { settled, onSettle, next };
}

describe("toolImageThumbnails", () => {
  describe("ToolImageThumbnails", () => {
    describe("stage()", () => {
      it("returns outputs without images unchanged", () => {
        const { shrink, started } = controlledShrinker();
        const thumbnails = new ToolImageThumbnails(shrink, () => undefined);
        const outputs: AgentToolCallOutput[] = [{ type: "text", text: "Note read" }];

        expect(thumbnails.stage(outputs)).toBe(outputs);
        expect(started).toHaveLength(0);
      });

      it("swaps each full-size image for a pending placeholder and shrinks the original https://github.com/logancyang/obsidian-copilot/issues/4248", () => {
        const { shrink, started } = controlledShrinker();
        const thumbnails = new ToolImageThumbnails(shrink, () => undefined);

        const staged = thumbnails.stage([{ type: "text", text: "Chart read" }, CHART]);

        expect(staged[0]).toEqual({ type: "text", text: "Chart read" });
        expect(staged[1]).toMatchObject({ type: "image_pending" });
        expect(JSON.stringify(staged)).not.toContain(CHART.data);
        expect(started.map((s) => s.image)).toEqual([CHART]);
      });

      it("reports the thumbnail for the placeholder's key once shrinking finishes https://github.com/logancyang/obsidian-copilot/issues/4248", async () => {
        const { shrink, started } = controlledShrinker();
        const recorder = settleRecorder();
        const thumbnails = new ToolImageThumbnails(shrink, recorder.onSettle);
        const [placeholder] = thumbnails.stage([CHART]);
        const settledOnce = recorder.next();

        started[0].resolve(CHART_THUMB);
        await settledOnce;

        expect(placeholder.type === "image_pending" && placeholder.key).toBe(
          recorder.settled[0].key
        );
        expect(recorder.settled[0].thumbnail).toEqual(CHART_THUMB);
      });

      it("gives a repeated image the same placeholder while it shrinks and shrinks it only once", () => {
        const { shrink, started } = controlledShrinker();
        const thumbnails = new ToolImageThumbnails(shrink, () => undefined);

        const first = thumbnails.stage([CHART]);
        const repeat = thumbnails.stage([{ ...CHART }]);

        expect(repeat).toEqual(first);
        expect(started).toHaveLength(1);
      });

      it("returns the finished thumbnail directly when an already-shrunk image arrives again", async () => {
        const { shrink, started } = controlledShrinker();
        const recorder = settleRecorder();
        const thumbnails = new ToolImageThumbnails(shrink, recorder.onSettle);
        thumbnails.stage([CHART]);
        const settledOnce = recorder.next();
        started[0].resolve(CHART_THUMB);
        await settledOnce;

        expect(thumbnails.stage([CHART])).toEqual([CHART_THUMB]);
        expect(started).toHaveLength(1);
      });

      it("keeps a finished thumbnail as is when its tool call is updated again", async () => {
        const { shrink, started } = controlledShrinker();
        const recorder = settleRecorder();
        const thumbnails = new ToolImageThumbnails(shrink, recorder.onSettle);
        thumbnails.stage([CHART]);
        const settledOnce = recorder.next();
        started[0].resolve(CHART_THUMB);
        await settledOnce;

        expect(thumbnails.stage([CHART_THUMB])).toEqual([CHART_THUMB]);
        expect(started).toHaveLength(1);
      });

      it("reports no thumbnail and drops later copies of an image it could not shrink", async () => {
        const { shrink, started } = controlledShrinker();
        const recorder = settleRecorder();
        const thumbnails = new ToolImageThumbnails(shrink, recorder.onSettle);
        thumbnails.stage([SCREENSHOT]);
        const settledOnce = recorder.next();

        started[0].reject(new Error("decode failed"));
        await settledOnce;

        expect(recorder.settled[0].thumbnail).toBeNull();
        expect(thumbnails.stage([{ type: "text", text: "Read" }, SCREENSHOT])).toEqual([
          { type: "text", text: "Read" },
        ]);
      });

      it("shrinks at most two images at a time and starts the next when one finishes https://github.com/logancyang/obsidian-copilot/issues/4248", async () => {
        const { shrink, started } = controlledShrinker();
        const recorder = settleRecorder();
        const thumbnails = new ToolImageThumbnails(shrink, recorder.onSettle);

        thumbnails.stage([CHART, DIAGRAM, SCREENSHOT]);
        expect(started.map((s) => s.image)).toEqual([CHART, DIAGRAM]);

        const settledOnce = recorder.next();
        started[0].resolve(CHART_THUMB);
        await settledOnce;

        expect(started.map((s) => s.image)).toEqual([CHART, DIAGRAM, SCREENSHOT]);
      });
    });

    describe("dispose()", () => {
      it("reports nothing and starts no queued shrink after the chat closes", async () => {
        const { shrink, started } = controlledShrinker();
        const recorder = settleRecorder();
        const thumbnails = new ToolImageThumbnails(shrink, recorder.onSettle);
        thumbnails.stage([CHART, DIAGRAM, SCREENSHOT]);

        thumbnails.dispose();
        started[0].resolve(CHART_THUMB);
        await started[0].done;

        expect(recorder.settled).toEqual([]);
        expect(started).toHaveLength(2);
      });
    });
  });

  describe("shrinkToolImage()", () => {
    const originalCreateImageBitmap = window.createImageBitmap;
    const originalOffscreenCanvas = window.OffscreenCanvas;
    let drawn: { width: number; height: number } | null;
    let encodedBytes: number;

    beforeEach(() => {
      drawn = null;
      encodedBytes = 4;
      window.createImageBitmap = jest.fn(async () => ({
        width: 2400,
        height: 1500,
        close: jest.fn(),
      }));
      window.OffscreenCanvas = class {
        constructor(
          public width: number,
          public height: number
        ) {}
        getContext() {
          return {
            drawImage: (_: unknown, __: number, ___: number, width: number, height: number) => {
              drawn = { width, height };
            },
          };
        }
        async convertToBlob(options: { type: string }) {
          const bytes = new Uint8Array(encodedBytes);
          return { type: options.type, arrayBuffer: async () => bytes.buffer };
        }
      } as unknown as typeof OffscreenCanvas;
    });

    afterEach(() => {
      window.createImageBitmap = originalCreateImageBitmap;
      window.OffscreenCanvas = originalOffscreenCanvas;
    });

    it("redraws a large image within 160 pixels, keeping its aspect ratio, as WebP https://github.com/logancyang/obsidian-copilot/issues/4248", async () => {
      const thumbnail = await shrinkToolImage({
        type: "image",
        mimeType: "image/png",
        data: "A".repeat(4000),
      });

      expect(drawn).toEqual({ width: 160, height: 100 });
      expect(thumbnail.mimeType).toBe("image/webp");
      expect(thumbnail.data).toBe("AAAAAA==");
    });

    it("keeps the original when the WebP would not be smaller", async () => {
      encodedBytes = 3000;
      const tiny: ToolImage = { type: "image", mimeType: "image/png", data: "iVBORw0K" };

      expect(await shrinkToolImage(tiny)).toEqual(tiny);
    });
  });
});
