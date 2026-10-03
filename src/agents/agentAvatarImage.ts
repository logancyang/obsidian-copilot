export const AGENT_AVATAR_SIZE_PX = 256;

const AGENT_AVATAR_MIME = "image/webp";
const AGENT_AVATAR_QUALITY = 0.9;

export async function encodeAgentAvatar(file: Blob): Promise<ArrayBuffer> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = createEl("canvas");
    canvas.width = AGENT_AVATAR_SIZE_PX;
    canvas.height = AGENT_AVATAR_SIZE_PX;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the image.");
    context.imageSmoothingQuality = "high";
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AGENT_AVATAR_SIZE_PX,
      AGENT_AVATAR_SIZE_PX
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, AGENT_AVATAR_MIME, AGENT_AVATAR_QUALITY)
    );
    if (!blob) throw new Error("Could not encode the image.");
    return await blob.arrayBuffer();
  } finally {
    bitmap.close();
  }
}

export function createAvatarPreviewUrl(image: ArrayBuffer): string {
  return URL.createObjectURL(new Blob([image], { type: AGENT_AVATAR_MIME }));
}

export function revokeAvatarPreviewUrl(url: string): void {
  URL.revokeObjectURL(url);
}
