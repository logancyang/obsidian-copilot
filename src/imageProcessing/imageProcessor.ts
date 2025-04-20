import { logError } from "@/logger";
import { safeFetch } from "@/utils";
import { Notice, TFile, Vault } from "obsidian";

export interface ImageContent {
  type: "image_url";
  image_url: {
    url: string;
  };
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageProcessingResult {
  successfulImages: ImageContent[];
  failureDescriptions: string[];
}

export type MessageContent = ImageContent | TextContent;

export class ImageProcessor {
  private static readonly IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

  private static readonly MAX_IMAGE_SIZE = 3 * 1024 * 1024; // 3MB
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
      // Extract extension from the URL or file path
      const extension = url.split(".").pop()?.toLowerCase();
      if (extension) {
        // Check if the extension is supported
        const isSupported = this.IMAGE_EXTENSIONS.some(
          (ext) => ext.toLowerCase() === `.${extension}`
        );

        if (!isSupported) {
          const msg = `Unsupported image format: .${extension}. Supported formats: ${this.IMAGE_EXTENSIONS.join(", ")}`;
          logError(msg);
          new Notice(msg);
          return false;
        }
      }

      // First check if it's an Obsidian vault image path
      if (this.IMAGE_EXTENSIONS.some((ext) => url.toLowerCase().endsWith(ext))) {
        // Verify the file exists and is accessible
        const file = vault.getAbstractFileByPath(url);
        if (!file || !(file instanceof TFile)) {
          logError(`File not found in vault: ${url}`);
          return false;
        }

        // Check file size
        if (file.stat.size > this.MAX_IMAGE_SIZE) {
          logError(`File too large: ${file.stat.size} bytes`);
          return false;
        }

        return true;
      }

      // Then check if it's a valid URL
      const urlObj = new URL(url);

      // First check: URL path ends with image extension
      if (this.IMAGE_EXTENSIONS.some((ext) => urlObj.pathname.toLowerCase().endsWith(ext))) {
        return true;
      }

      // Second check: Try HEAD request to check content-type
      try {
        const response = await safeFetch(url, {
          method: "HEAD",
          headers: {}, // Explicitly set empty headers
        });

        const contentType = response.headers.get("content-type");
        if (contentType?.startsWith("image/")) {
          return true;
        }
      } catch (error) {
        logError(`Error checking content-type for URL: ${url}`, error);
      }

      // Final check: Analyze URL patterns that commonly indicate image content
      const searchParams = urlObj.searchParams;
      const imageIndicators = [
        // Image dimensions
        searchParams.has("w") || searchParams.has("width"),
        searchParams.has("h") || searchParams.has("height"),
        // Image processing
        searchParams.has("format"),
        searchParams.has("fit"),
        // Image quality
        searchParams.has("q") || searchParams.has("quality"),
        // Common CDN image path patterns
        urlObj.pathname.includes("/image/"),
        urlObj.pathname.includes("/images/"),
        urlObj.pathname.includes("/img/"),
        // Common image processing parameters
        searchParams.has("auto"),
        searchParams.has("crop"),
      ];

      // If multiple image-related indicators are present, likely an image URL
      const imageIndicatorCount = imageIndicators.filter(Boolean).length;
      return imageIndicatorCount >= 2; // Require at least 2 indicators to consider it an image URL
    } catch {
      // If URL construction fails, it might still be a valid Obsidian vault image path
      return this.IMAGE_EXTENSIONS.some((ext) => url.toLowerCase().endsWith(ext));
    }
  }

  private static async handleVaultImage(file: TFile, vault: Vault): Promise<string | null> {
    try {
      // Check file size first
      if (file.stat.size > this.MAX_IMAGE_SIZE) {
        logError(`Image too large: ${file.stat.size} bytes, skipping: ${file.path}`);
        return null;
      }

      // Read the file as array buffer
      const arrayBuffer = await vault.readBinary(file);

      // Validate MIME type
      const mimeType = await this.getMimeType(arrayBuffer, file.extension);
      if (!mimeType.startsWith("image/")) {
        logError(`Invalid MIME type: ${mimeType}, skipping: ${file.path}`);
        return null;
      }

      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString("base64");

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

      // Try to get content type from response headers
      const contentType = response.headers.get("content-type");
      if (!contentType?.startsWith("image/")) {
        logError(`Invalid content type: ${contentType}, URL: ${imageUrl}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();

      // Check file size
      if (arrayBuffer.byteLength > this.MAX_IMAGE_SIZE) {
        logError(`Image too large: ${arrayBuffer.byteLength} bytes, URL: ${imageUrl}`);
        return null;
      }

      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString("base64");
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

      // Check file size
      if (file.stat.size > this.MAX_IMAGE_SIZE) {
        logError(`Image too large: ${file.stat.size} bytes, path: ${localPath}`);
        return null;
      }

      // Read the file as array buffer
      const arrayBuffer = await vault.readBinary(file);

      // Validate MIME type
      const mimeType = await this.getMimeType(arrayBuffer, file.extension);
      if (!mimeType.startsWith("image/")) {
        logError(`Invalid MIME type: ${mimeType}, path: ${localPath}`);
        return null;
      }

      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString("base64");

      const result = `data:${mimeType};base64,${base64}`;
      return result;
    } catch (error) {
      logError("Error processing local image:", error);
      return null;
    }
  }

  private static async imageToBase64(imageUrl: string, vault: Vault): Promise<string | null> {
    // If it's already a data URL, return it as is
    if (imageUrl.startsWith("data:")) {
      return imageUrl;
    }

    // Check if it's a local vault image
    if (imageUrl.startsWith("app://")) {
      return await this.handleLocalImage(imageUrl, vault);
    }

    // Check if it's an Obsidian vault image (direct file path)
    const file = vault.getAbstractFileByPath(imageUrl);
    if (file instanceof TFile) {
      return await this.handleVaultImage(file, vault);
    }

    // Handle web images
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
    // Get the first few bytes to check for magic numbers
    const bytes = new Uint8Array(arrayBuffer.slice(0, 4));

    // Check for common image magic numbers
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
    if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp";
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
    if (bytes[0] === 0x3c && bytes[1] === 0x73) {
      throw new Error("SVG files are not supported");
    }

    // Fall back to extension-based detection
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
        failedImages.push(url);
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
