import { OBSIDIAN_PUBLISH_BASELINE } from "@/symposium/obsidianPublishBaseline";

describe("obsidianPublishBaseline", () => {
  describe("OBSIDIAN_PUBLISH_BASELINE", () => {
    it("styles the core reading-view structures used by published notes", () => {
      expect(OBSIDIAN_PUBLISH_BASELINE).toContain(".markdown-rendered h1");
      expect(OBSIDIAN_PUBLISH_BASELINE).toContain(".markdown-rendered table");
      expect(OBSIDIAN_PUBLISH_BASELINE).toContain(".markdown-rendered pre");
      expect(OBSIDIAN_PUBLISH_BASELINE).toContain(".markdown-rendered .callout");
      expect(OBSIDIAN_PUBLISH_BASELINE).toContain(".markdown-rendered .markdown-embed");
      expect(OBSIDIAN_PUBLISH_BASELINE).toContain(".markdown-rendered .canvas-minimap path");
      expect(OBSIDIAN_PUBLISH_BASELINE).toContain(".markdown-rendered .canvas-minimap rect");
      expect(OBSIDIAN_PUBLISH_BASELINE).toContain("fill: var(--background-primary)");
      expect(OBSIDIAN_PUBLISH_BASELINE).toContain("stroke: var(--text-muted)");
      expect(OBSIDIAN_PUBLISH_BASELINE).toContain(".symposium-missing-asset");
    });

    it("defines a responsive neutral page without depending on Obsidian theme styles", () => {
      expect(OBSIDIAN_PUBLISH_BASELINE).toContain("--background-primary: #ffffff");
      expect(OBSIDIAN_PUBLISH_BASELINE).toContain(".publish-renderer");
      expect(OBSIDIAN_PUBLISH_BASELINE).toContain("@media (max-width: 40rem)");
      expect(OBSIDIAN_PUBLISH_BASELINE).not.toContain("body.theme-");
    });
  });
});
