import type { AgentToolCallOutput } from "@/agentMode/session/types";
import { logWarn } from "@/logger";
import { arrayBufferToBase64, base64ToArrayBuffer } from "@/utils/base64";
import { md5 } from "@/utils/hash";

export type ToolImage = Extract<AgentToolCallOutput, { type: "image" }>;

export type ShrinkToolImage = (image: ToolImage) => Promise<ToolImage>;

const THUMBNAIL_EDGE_PX = 160;
const MAX_CONCURRENT_SHRINKS = 2;

export async function shrinkToolImage(image: ToolImage): Promise<ToolImage> {
  const source = new Blob([base64ToArrayBuffer(image.data)], { type: image.mimeType });
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, THUMBNAIL_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale))
    );
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
    const thumbnail: ToolImage = {
      type: "image",
      mimeType: blob.type,
      data: arrayBufferToBase64(await blob.arrayBuffer()),
    };
    return thumbnail.data.length < image.data.length ? thumbnail : image;
  } finally {
    bitmap.close();
  }
}

function imageKey(image: ToolImage): string {
  return `${image.mimeType}:${md5(image.data)}`;
}

export class ToolImageThumbnails {
  private readonly finished = new Map<string, ToolImage | null>();
  private readonly waiting = new Map<string, ToolImage>();
  private readonly queue: string[] = [];
  private running = 0;
  private disposed = false;

  constructor(
    private readonly shrink: ShrinkToolImage,
    private readonly onSettle: (key: string, thumbnail: ToolImage | null) => void
  ) {}

  stage(outputs: AgentToolCallOutput[]): AgentToolCallOutput[] {
    if (!outputs.some((output) => output.type === "image")) return outputs;
    return outputs.flatMap((output): AgentToolCallOutput[] => {
      if (output.type !== "image") return [output];
      const key = imageKey(output);
      const thumbnail = this.finished.get(key);
      if (thumbnail === null) return [];
      if (thumbnail) return [thumbnail];
      if (!this.waiting.has(key)) {
        this.waiting.set(key, output);
        this.queue.push(key);
        this.startNext();
      }
      return [{ type: "image_pending", key }];
    });
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    this.waiting.clear();
  }

  private startNext(): void {
    while (!this.disposed && this.running < MAX_CONCURRENT_SHRINKS && this.queue.length > 0) {
      const key = this.queue.shift()!;
      const image = this.waiting.get(key)!;
      this.running += 1;
      void this.run(key, image);
    }
  }

  private async run(key: string, image: ToolImage): Promise<void> {
    let thumbnail: ToolImage | null;
    try {
      thumbnail = await this.shrink(image);
    } catch (error) {
      logWarn("[AgentMode] could not shrink a tool image; its preview is skipped", error);
      thumbnail = null;
    }
    this.running -= 1;
    if (this.disposed) return;
    this.waiting.delete(key);
    this.finished.set(key, thumbnail);
    if (thumbnail) this.finished.set(imageKey(thumbnail), thumbnail);
    this.onSettle(key, thumbnail);
    this.startNext();
  }
}
