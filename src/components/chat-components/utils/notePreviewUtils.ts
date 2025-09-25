import { TFile, App } from "obsidian";

// Get app instance
declare const app: App;

/**
 * Loads and processes note content for preview display.
 * Handles PDF files, frontmatter stripping, and content truncation.
 *
 * @param file - The file to load content from
 * @param maxLength - Maximum length for truncated content (default: 500)
 * @returns Promise resolving to processed content string
 */
export async function loadNoteContentForPreview(
  file: TFile,
  maxLength: number = 500
): Promise<string> {
  try {
    // Handle PDF files - treat as empty content (no preview)
    if (file.extension === "pdf") {
      return "";
    }

    const content = await app.vault.cachedRead(file);

    // Strip frontmatter (YAML front matter) from the content
    const contentWithoutFrontmatter = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();

    // Truncate content if necessary
    const truncatedContent =
      contentWithoutFrontmatter.length > maxLength
        ? contentWithoutFrontmatter.slice(0, maxLength) + "..."
        : contentWithoutFrontmatter;

    return truncatedContent;
  } catch (error) {
    console.warn("Failed to read note content:", error);
    return "Failed to load content";
  }
}

/**
 * Cache for storing note preview content to avoid repeated file reads
 */
export class NotePreviewCache {
  private cache = new Map<string, string>();

  /**
   * Gets cached content or loads it if not cached
   * @param file - The file to get content for
   * @param maxLength - Maximum length for truncated content
   * @returns Promise resolving to processed content string
   */
  async getOrLoadContent(file: TFile, maxLength: number = 500): Promise<string> {
    const cached = this.cache.get(file.path);
    if (cached !== undefined) {
      return cached;
    }

    const content = await loadNoteContentForPreview(file, maxLength);
    this.cache.set(file.path, content);
    return content;
  }

  /**
   * Clears the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Removes a specific file from the cache
   * @param filePath - Path of the file to remove from cache
   */
  remove(filePath: string): void {
    this.cache.delete(filePath);
  }

  /**
   * Checks if content is cached for a file
   * @param filePath - Path of the file to check
   * @returns True if content is cached
   */
  has(filePath: string): boolean {
    return this.cache.has(filePath);
  }
}
