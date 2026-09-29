export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES_PER_COMMAND = 4;
export const MAX_IMAGE_BYTES_PER_COMMAND = 24 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

export function decodedBase64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

export interface ImageLimitViolation {
  code: "too_large" | "invalid";
  message: string;
}

// The host and every composer share one reading of the limits, so a message the composer accepts
// is a message the host's `send` accepts.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
// A phone builds a whole command in memory as one message, with each image as base64 a third larger
// than the file, and the desktop's listener refuses messages over 16 MiB by closing the connection.
// The images of one command may total at most this many decoded bytes over that link.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export const REMOTE_IMAGE_BYTES_PER_COMMAND = 5 * 1024 * 1024;

export function checkImageLimits(
  images: readonly { mimeType: string; bytes: number }[],
  budgetBytes: number = MAX_IMAGE_BYTES_PER_COMMAND
): ImageLimitViolation | null {
  if (images.length > MAX_IMAGES_PER_COMMAND) {
    return { code: "too_large", message: `At most ${MAX_IMAGES_PER_COMMAND} images per message` };
  }
  let totalBytes = 0;
  for (const image of images) {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(image.mimeType)) {
      return { code: "invalid", message: `Unsupported image type ${image.mimeType}` };
    }
    totalBytes += image.bytes;
    if (image.bytes > MAX_IMAGE_BYTES || totalBytes > MAX_IMAGE_BYTES_PER_COMMAND) {
      return { code: "too_large", message: "Image data exceeds the size limit" };
    }
    if (totalBytes > budgetBytes) {
      const megabytes = Math.floor(budgetBytes / (1024 * 1024));
      return { code: "too_large", message: `Images can total at most ${megabytes} MB from here` };
    }
  }
  return null;
}
