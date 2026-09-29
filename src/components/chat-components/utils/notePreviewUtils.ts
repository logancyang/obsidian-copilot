import { TFile, App } from "obsidian";
import { logWarn } from "@/logger";

async function loadNoteContentForPreview(
  app: App,
  file: TFile,
  maxLength: number = 500
): Promise<string> {
  try {
    if (file.extension === "pdf" || file.extension === "canvas") {
      return "";
    }

    const content = await app.vault.cachedRead(file);

    const contentWithoutFrontmatter = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();

    const truncatedContent =
      contentWithoutFrontmatter.length > maxLength
        ? contentWithoutFrontmatter.slice(0, maxLength) + "..."
        : contentWithoutFrontmatter;

    return truncatedContent;
  } catch (error) {
    logWarn("Failed to read note content:", error);
    return "Failed to load content";
  }
}

export class NotePreviewCache {
  private cache = new Map<string, string>();

  constructor(private readonly app: App) {}

  async getOrLoadContent(file: TFile, maxLength: number = 500): Promise<string> {
    const cached = this.cache.get(file.path);
    if (cached !== undefined) {
      return cached;
    }

    const content = await loadNoteContentForPreview(this.app, file, maxLength);
    this.cache.set(file.path, content);
    return content;
  }

  clear(): void {
    this.cache.clear();
  }

  remove(filePath: string): void {
    this.cache.delete(filePath);
  }

  has(filePath: string): boolean {
    return this.cache.has(filePath);
  }
}
