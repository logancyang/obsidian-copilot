import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PREPARE_SCRIPT = path.resolve(process.cwd(), "scripts/prepare-gallery-css.mjs");

describe("gallery-css", () => {
  describe("gallery chrome source", () => {
    it("defines exact development-only selectors for widths and single-side dividers", async () => {
      const [galleryCss, productionCss] = await Promise.all([
        readFile(path.resolve(process.cwd(), "dev/gallery/gallery.css"), "utf8"),
        readFile(path.resolve(process.cwd(), "src/styles/tailwind.css"), "utf8"),
      ]);

      for (const width of [300, 340, 400, 600]) {
        expect(galleryCss).toContain(
          `.copilot-gallery-canvas[data-gallery-width="${width}"] {\n  width: ${width}px;\n}`
        );
      }
      for (const [suffix, property] of [
        ["l", "border-left"],
        ["r", "border-right"],
      ]) {
        expect(galleryCss).toContain(
          `.copilot-gallery-divider-${suffix} {\n  ${property}: 1px solid var(--background-modifier-border);\n}`
        );
      }
      expect(galleryCss).toContain("flex: none;");
      expect(productionCss).not.toContain("copilot-gallery-canvas");
      expect(productionCss).not.toContain("copilot-gallery-divider");
      expect(productionCss).toContain(
        ".copilot-divider-b {\n  border-bottom: 1px solid var(--background-modifier-border);\n}"
      );
    });
  });

  describe("prepare CLI", () => {
    let projectRoot: string;

    beforeEach(async () => {
      projectRoot = await mkdtemp(path.join(tmpdir(), "gallery css "));
      await Promise.all([
        mkdir(path.join(projectRoot, "src/styles"), { recursive: true }),
        mkdir(path.join(projectRoot, "dev/gallery"), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(projectRoot, "src/styles/tailwind.css"), "production css\n"),
        writeFile(path.join(projectRoot, "dev/gallery/gallery.css"), "gallery css\n"),
      ]);
    });

    afterEach(async () => {
      await rm(projectRoot, { force: true, recursive: true });
    });

    it("composes the production source and tracked gallery chrome into an ignored input", async () => {
      await execFileAsync(process.execPath, [PREPARE_SCRIPT], { cwd: projectRoot });

      await expect(
        readFile(path.join(projectRoot, "dev/gallery/styles.source.css"), "utf8")
      ).resolves.toBe("production css\n\ngallery css\n");
    });
  });
});
