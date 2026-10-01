import { TFile, App } from "obsidian";
import { logWarn } from "@/logger";

const NOTE_PREVIEW_MAX_LENGTH = 500;

async function loadNoteContentForPreview(app: App, file: TFile): Promise<string> {
  try {
    if (file.extension === "pdf" || file.extension === "canvas") {
      return "";
    }

    const content = await app.vault.cachedRead(file);

    const contentWithoutFrontmatter = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();

    const truncatedContent =
      contentWithoutFrontmatter.length > NOTE_PREVIEW_MAX_LENGTH
        ? contentWithoutFrontmatter.slice(0, NOTE_PREVIEW_MAX_LENGTH) + "..."
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

  async getOrLoadContent(file: TFile): Promise<string> {
    const cached = this.cache.get(file.path);
    if (cached !== undefined) {
      return cached;
    }

    const content = await loadNoteContentForPreview(this.app, file);
    this.cache.set(file.path, content);
    return content;
  }
}
