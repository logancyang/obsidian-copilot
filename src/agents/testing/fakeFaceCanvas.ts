export interface FakeFaceCanvas {
  width: number;
  height: number;
  encoded: { type: string; quality: number } | null;
  context: { drawImage: jest.Mock; imageSmoothingQuality?: string } | null;
  bitmap: { width: number; height: number; close: jest.Mock };
}

export function installFakeFaceCanvas({
  uploadWidth,
  uploadHeight,
  encoded = new Uint8Array([82, 73, 70, 70]),
  hasContext = true,
}: {
  uploadWidth: number;
  uploadHeight: number;
  encoded?: Uint8Array | null;
  hasContext?: boolean;
}): FakeFaceCanvas {
  const bitmap = { width: uploadWidth, height: uploadHeight, close: jest.fn() };
  const canvas: FakeFaceCanvas & {
    getContext: () => FakeFaceCanvas["context"];
    toBlob: (done: (blob: Blob | null) => void, type: string, quality: number) => void;
  } = {
    width: 0,
    height: 0,
    encoded: null,
    context: hasContext ? { drawImage: jest.fn() } : null,
    bitmap,
    getContext: () => canvas.context,
    toBlob: (done, type, quality) => {
      canvas.encoded = { type, quality };
      done(
        encoded
          ? ({ arrayBuffer: () => Promise.resolve(encoded.slice().buffer) } as unknown as Blob)
          : null
      );
    },
  };
  Object.assign(window, {
    createEl: () => canvas,
    createImageBitmap: () => Promise.resolve(bitmap),
  });
  return canvas;
}
