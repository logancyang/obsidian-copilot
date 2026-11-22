import { logError, logWarn } from "@/logger";
import { safeFetch } from "@/utils";
import { arrayBufferToBase64 } from "@/utils/base64";
import { Notice, TFile, Vault } from "obsidian";

export interface ImageContent {
  type: "image_url";
  image_url: {
    url: string;
  };
  [key: string]: unknown;
}

export interface TextContent {
  type: "text";
  text: string;
  [key: string]: unknown;
}

export interface ImageProcessingResult {
  successfulImages: ImageContent[];
  failureDescriptions: string[];
}

export type MessageContent = ImageContent | TextContent;

export class ImageProcessor {
  private static readonly IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

  private static readonly MAX_IMAGE_SIZE = 3 * 1024 * 1024;
  private static readonly MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };

  static async isImageUrl(url: string, vault: Vault): Promise<boolean> {
    try {
      let potentialExtension: string | undefined = undefined;
      let isPotentiallyVaultPath = false;

      try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const lastDotIndex = pathname.lastIndexOf(".");
        const lastSlashIndex = pathname.lastIndexOf("/");
        if (lastDotIndex > lastSlashIndex && lastDotIndex > -1) {
          potentialExtension = pathname.substring(lastDotIndex + 1).toLowerCase();
        }

        if (potentialExtension) {
          const isSupported = this.IMAGE_EXTENSIONS.some(
            (ext) => ext.toLowerCase() === `.${potentialExtension}`
          );
          if (!isSupported) {
            logError(
              `Unsupported image format from URL path: .${potentialExtension}. Supported formats: ${this.IMAGE_EXTENSIONS.join(", ")}`,
              url
            );
            return false;
          }
        }

        try {
          const response = await safeFetch(url, {
            method: "HEAD",
            headers: {},
          });

          const contentType = response.headers.get("content-type");
          if (contentType?.startsWith("image/")) {
            return true;
          } else {
            logWarn(
              `HEAD request succeeded for ${url} but Content-Type (${contentType}) is not image/*.`
            );
            return false;
          }
        } catch (headError) {
          logWarn(`HEAD request failed for URL: ${url}. Proceeding to heuristic check.`, headError);
          const searchParams = urlObj.searchParams;
          const imageIndicators = [
            searchParams.has("w") || searchParams.has("width"),
            searchParams.has("h") || searchParams.has("height"),
            searchParams.has("format"),
            searchParams.has("fit"),
            searchParams.has("quality"),
            urlObj.pathname.includes("/image/"),
            urlObj.pathname.includes("/images/"),
            urlObj.pathname.includes("/img/"),
            searchParams.has("auto"),
            searchParams.has("crop"),
          ];
          const imageIndicatorCount = imageIndicators.filter(Boolean).length;
          if (imageIndicatorCount >= 2) {
            logError(
              `Identified as image based on URL heuristics (indicator count: ${imageIndicatorCount}): ${url}`
            );
            return true;
          }

          return false;
        }
      } catch {
        isPotentiallyVaultPath = true;
        const lastDotIndex = url.lastIndexOf(".");
        if (lastDotIndex > -1) {
          potentialExtension = url.substring(lastDotIndex + 1).toLowerCase();
        } else {
          return false;
        }
      }

      if (isPotentiallyVaultPath) {
        if (
          potentialExtension &&
          this.IMAGE_EXTENSIONS.some((ext) => ext.toLowerCase() === `.${potentialExtension}`)
        ) {
          const file = vault.getAbstractFileByPath(url);
          if (file instanceof TFile) {
            if (file.stat.size > this.MAX_IMAGE_SIZE) {
              logError(`Vault file too large: ${file.stat.size} bytes for path: ${url}`);
              return false;
            }
            return true;
          } else {
            logError(`File with image extension not found in vault: ${url}.`);
            return false;
          }
        } else {
          if (potentialExtension) {
            logError(
              `Unsupported image format for potential vault path: .${potentialExtension}. Supported formats: ${this.IMAGE_EXTENSIONS.join(", ")}`,
              url
            );
          }
          return false;
        }
      }

      logError(`Could not determine image status for URL/path: ${url}`);
      return false;
    } catch (e) {
      logError(`Unexpected error in isImageUrl for "${url}":`, e);
      return false;
    }
  }

  private static async handleVaultImage(file: TFile, vault: Vault): Promise<string | null> {
    try {
      if (file.stat.size > this.MAX_IMAGE_SIZE) {
        logError(`Image too large: ${file.stat.size} bytes, skipping: ${file.path}`);
        return null;
      }

      const arrayBuffer = await vault.readBinary(file);

      const mimeType = await this.getMimeType(arrayBuffer, file.extension);
      if (!mimeType.startsWith("image/")) {
        logError(`Invalid MIME type: ${mimeType}, skipping: ${file.path}`);
        return null;
      }

      const base64 = arrayBufferToBase64(arrayBuffer);

      const result = `data:${mimeType};base64,${base64}`;
      return result;
    } catch (error) {
      logError("Error processing vault image:", error);
      return null;
    }
  }

  private static async handleWebImage(imageUrl: string): Promise<string | null> {
    try {
      const response = await safeFetch(imageUrl, {
        method: "GET",
        headers: {},
      });

      if (!response.ok) {
        logError(`Failed to fetch image: ${response.statusText}, URL: ${imageUrl}`);
        return null;
      }

      const contentType = response.headers.get("content-type");
      if (!contentType?.startsWith("image/")) {
        logError(`Invalid content type: ${contentType}, URL: ${imageUrl}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();

      if (arrayBuffer.byteLength > this.MAX_IMAGE_SIZE) {
        logError(`Image too large: ${arrayBuffer.byteLength} bytes, URL: ${imageUrl}`);
        return null;
      }

      const base64 = arrayBufferToBase64(arrayBuffer);
      return `data:${contentType};base64,${base64}`;
    } catch (error) {
      logError("Error converting web image to base64:", error);
      return null;
    }
  }

  private static async handleLocalImage(imageUrl: string, vault: Vault): Promise<string | null> {
    try {
      const localPath = decodeURIComponent(imageUrl.replace("app://", ""));
      const file = vault.getAbstractFileByPath(localPath);
      if (!file || !(file instanceof TFile)) {
        logError(`Local image not found: ${localPath}`);
        return null;
      }

      if (file.stat.size > this.MAX_IMAGE_SIZE) {
        logError(`Image too large: ${file.stat.size} bytes, path: ${localPath}`);
        return null;
      }

      const arrayBuffer = await vault.readBinary(file);

      const mimeType = await this.getMimeType(arrayBuffer, file.extension);
      if (!mimeType.startsWith("image/")) {
        logError(`Invalid MIME type: ${mimeType}, path: ${localPath}`);
        return null;
      }

      const base64 = arrayBufferToBase64(arrayBuffer);

      const result = `data:${mimeType};base64,${base64}`;
      return result;
    } catch (error) {
      logError("Error processing local image:", error);
      return null;
    }
  }

  private static async imageToBase64(imageUrl: string, vault: Vault): Promise<string | null> {
    if (imageUrl.startsWith("data:")) {
      return imageUrl;
    }

    if (imageUrl.startsWith("attachment:")) {
      const filePath = imageUrl.substring(11);
      const file = vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        return await this.handleVaultImage(file, vault);
      } else {
        logWarn(`Could not find attachment file in vault: ${filePath}`);
        return null;
      }
    }

    if (imageUrl.startsWith("app://")) {
      return await this.handleLocalImage(imageUrl, vault);
    }

    const file = vault.getAbstractFileByPath(imageUrl);
    if (file instanceof TFile) {
      return await this.handleVaultImage(file, vault);
    }

    return await this.handleWebImage(imageUrl);
  }

  static async convertToBase64(imageUrl: string, vault: Vault): Promise<ImageContent | null> {
    const base64Url = await this.imageToBase64(imageUrl, vault);
    if (!base64Url) {
      logError(`Failed to convert image to base64: ${imageUrl}`);
      return null;
    }
    return {
      type: "image_url",
      image_url: {
        url: base64Url,
      },
    };
  }

  private static async getMimeType(arrayBuffer: ArrayBuffer, extension: string): Promise<string> {
    const bytes = new Uint8Array(arrayBuffer.slice(0, 4));

    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
    if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp";
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
    if (bytes[0] === 0x3c && bytes[1] === 0x73) {
      throw new Error("SVG files are not supported");
    }

    const mimeType = this.MIME_TYPES[extension.toLowerCase() as keyof typeof this.MIME_TYPES];
    if (!mimeType) {
      const error = `Unsupported image extension: ${extension}`;
      logError(error);
      throw new Error(error);
    }
    return mimeType;
  }
}

export class ImageBatchProcessor {
  static async processUrlBatch(
    urls: string[],
    failedImages: string[],
    vault: Vault
  ): Promise<ImageProcessingResult> {
    try {
      const results = await Promise.all(
        urls.map((url) => ImageBatchProcessor.processSingleUrl(url, failedImages, vault))
      );

      const successfulImages = results.filter((item): item is ImageContent => item !== null);
      const failureDescriptions = failedImages.map((url) => `Image read failed for: ${url}`);

      return {
        successfulImages,
        failureDescriptions,
      };
    } catch (error) {
      logError("Error processing URL batch:", error);
      return {
        successfulImages: [],
        failureDescriptions: urls.map((url) => `Image read failed for: ${url}`),
      };
    }
  }

  static async processSingleUrl(
    url: string,
    failedImages: string[],
    vault: Vault
  ): Promise<ImageContent | null> {
    try {
      if (!(await ImageProcessor.isImageUrl(url, vault))) {
        return null;
      }

      const imageContent = await ImageProcessor.convertToBase64(url, vault);

      if (!imageContent) {
        failedImages.push(url);
        return null;
      }

      return imageContent;
    } catch (error) {
      logError(`Failed to process image: ${url}`, error);
      failedImages.push(url);
      return null;
    }
  }

  static async processChatImageBatch(
    content: MessageContent[],
    failedImages: string[],
    vault: Vault
  ): Promise<ImageProcessingResult> {
    try {
      const imageItems = content.filter(
        (item): item is ImageContent => item.type === "image_url" && !!item.image_url?.url
      );

      const results = await Promise.all(
        imageItems.map((item) =>
          ImageBatchProcessor.processChatSingleImage(item, failedImages, vault)
        )
      );

      const successfulImages = results.filter((item): item is ImageContent => item !== null);
      const failureDescriptions = failedImages.map((url) => `Image read failed for: ${url}`);

      return {
        successfulImages,
        failureDescriptions,
      };
    } catch (error) {
      logError("Error processing chat image batch:", error);
      const imageUrls = content
        .filter((item): item is ImageContent => item.type === "image_url" && !!item.image_url?.url)
        .map((item) => item.image_url.url);
      return {
        successfulImages: [],
        failureDescriptions: imageUrls.map((url) => `Image read failed for: ${url}`),
      };
    }
  }

  static async processChatSingleImage(
    item: ImageContent,
    failedImages: string[],
    vault: Vault
  ): Promise<ImageContent | null> {
    try {
      const processedContent = await ImageProcessor.convertToBase64(item.image_url.url, vault);

      if (!processedContent) {
        failedImages.push(item.image_url.url);
        return null;
      }

      return processedContent;
    } catch (error) {
      logError(`Failed to process chat image: ${item.image_url.url}`, error);
      failedImages.push(item.image_url.url);
      return null;
    }
  }

  static showFailedImagesNotice(failedImages: string[]): void {
    if (failedImages.length > 0) {
      new Notice(`Failed to process images:\n${failedImages.join("\n")}`);
    }
  }
}
