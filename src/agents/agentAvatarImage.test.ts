import {
  AGENT_AVATAR_SIZE_PX,
  createAvatarPreviewUrl,
  encodeAgentAvatar,
  revokeAvatarPreviewUrl,
} from "@/agents/agentAvatarImage";

interface FakeContext {
  imageSmoothingQuality?: string;
  drawImage: jest.Mock;
}

function installCanvas(blob: Blob | null, context: FakeContext | null) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (done: (value: Blob | null) => void, type: string, quality: number) => {
      canvas.encoded = { type, quality };
      done(blob);
    },
    encoded: null as { type: string; quality: number } | null,
  };
  (window as unknown as { createEl: () => unknown }).createEl = () => canvas;
  return canvas;
}

function installBitmap(width: number, height: number) {
  const bitmap = { width, height, close: jest.fn() };
  (window as unknown as { createImageBitmap: () => Promise<unknown> }).createImageBitmap = () =>
    Promise.resolve(bitmap);
  return bitmap;
}

function encodedBlob(bytes: number): Blob {
  return { arrayBuffer: () => Promise.resolve(new ArrayBuffer(bytes)) } as unknown as Blob;
}

describe("agentAvatarImage", () => {
  describe("encodeAgentAvatar()", () => {
    it("crops a landscape photo to its centered square and scales it to the stored size as WebP", async () => {
      const bitmap = installBitmap(900, 600);
      const context = { drawImage: jest.fn() };
      const canvas = installCanvas(encodedBlob(12), context);

      const bytes = await encodeAgentAvatar(new Blob(["x"]));

      expect(bytes.byteLength).toBe(12);
      expect(canvas.width).toBe(AGENT_AVATAR_SIZE_PX);
      expect(canvas.height).toBe(AGENT_AVATAR_SIZE_PX);
      expect(context.drawImage).toHaveBeenCalledWith(
        bitmap,
        150,
        0,
        600,
        600,
        0,
        0,
        AGENT_AVATAR_SIZE_PX,
        AGENT_AVATAR_SIZE_PX
      );
      expect(canvas.encoded?.type).toBe("image/webp");
      expect(bitmap.close).toHaveBeenCalled();
    });

    it("rejects when the browser cannot encode the image, releasing the decoded bitmap", async () => {
      const bitmap = installBitmap(100, 100);
      installCanvas(null, { drawImage: jest.fn() });

      await expect(encodeAgentAvatar(new Blob(["x"]))).rejects.toThrow(
        "Could not encode the image."
      );
      expect(bitmap.close).toHaveBeenCalled();
    });

    it("rejects when no drawing context is available", async () => {
      installBitmap(100, 100);
      installCanvas(encodedBlob(1), null);

      await expect(encodeAgentAvatar(new Blob(["x"]))).rejects.toThrow(
        "Could not prepare the image."
      );
    });
  });

  describe("createAvatarPreviewUrl()", () => {
    it("serves the encoded bytes as a WebP object URL", () => {
      const createObjectURL = jest.fn(() => "blob:preview");
      Object.assign(URL, { createObjectURL });

      expect(createAvatarPreviewUrl(new ArrayBuffer(4))).toBe("blob:preview");
      expect((createObjectURL.mock.calls[0] as unknown as [Blob])[0].type).toBe("image/webp");
    });
  });

  describe("revokeAvatarPreviewUrl()", () => {
    it("releases the object URL", () => {
      const revokeObjectURL = jest.fn();
      Object.assign(URL, { revokeObjectURL });

      revokeAvatarPreviewUrl("blob:preview");

      expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    });
  });
});
