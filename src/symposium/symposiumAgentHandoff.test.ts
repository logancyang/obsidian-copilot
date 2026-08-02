import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { consumeSymposiumAgentHandoff } from "@/symposium/symposiumAgentHandoff";
import { SYMPOSIUM_MAX_HTML_BYTES } from "@/symposium/constants";

const STAGED_PATH = ".symposium/handoffs/review.html";

describe("symposiumAgentHandoff", () => {
  let vaultRoot: string;

  beforeEach(async () => {
    vaultRoot = await mkdtemp(path.join(tmpdir(), "symposium-handoff-"));
    await mkdir(path.join(vaultRoot, ".symposium", "handoffs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(vaultRoot, { recursive: true, force: true });
  });

  describe("consumeSymposiumAgentHandoff()", () => {
    it("wraps exact UTF-8 bytes in a verifiable sandboxed browser preview", async () => {
      const html = '\uFEFF<!doctype html><p data-label="A & B">Résumé</p>\n';
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(absolutePath, new TextEncoder().encode(html));

      const handoff = await consumeSymposiumAgentHandoff(vaultRoot, STAGED_PATH);

      expect(Object.isFrozen(handoff)).toBe(true);
      expect(handoff.html).toBe(html);
      expect(handoff.previewUrl).toBe(pathToFileURL(handoff.previewPath).href);
      const browserPreview = await readFile(handoff.previewPath, "utf8");
      const parsedPreview = new DOMParser().parseFromString(browserPreview, "text/html");
      const policy = parsedPreview.querySelector('meta[http-equiv="Content-Security-Policy"]');
      const frame = parsedPreview.querySelector("iframe");
      expect(policy?.getAttribute("content")).toContain("default-src 'none'");
      expect(policy?.getAttribute("content")).toContain("connect-src 'none'");
      expect(policy?.getAttribute("content")).toContain("script-src 'unsafe-inline'");
      expect(policy?.getAttribute("content")).toContain("frame-src 'self'");
      expect(frame?.getAttribute("sandbox")).toBe("allow-same-origin");
      expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
      const srcdoc = frame?.getAttribute("srcdoc") ?? "";
      const parsedContent = new DOMParser().parseFromString(srcdoc, "text/html");
      const contentPolicy = parsedContent.querySelector(
        'meta[http-equiv="Content-Security-Policy"]'
      );
      expect(contentPolicy?.getAttribute("content")).toContain("frame-src 'none'");
      expect(contentPolicy?.getAttribute("content")).toContain("script-src 'none'");
      expect(srcdoc.endsWith(html)).toBe(true);
      expect(parsedPreview.querySelectorAll("iframe")).toHaveLength(1);
      expect(parsedPreview.querySelector("script")?.textContent).toContain(
        '["auxclick","click","contextmenu","dragstart","submit"]'
      );
      await expect(handoff.isPreviewCurrent()).resolves.toBe(true);
      await expect(readFile(absolutePath)).rejects.toMatchObject({ code: "ENOENT" });

      await rm(handoff.previewPath);
      await writeFile(handoff.previewPath, "changed bytes", "utf8");
      await expect(handoff.isPreviewCurrent()).resolves.toBe(false);

      await handoff.cleanup();
      await expect(readFile(handoff.previewPath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("rejects invalid UTF-8 and still removes the artifact", async () => {
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(absolutePath, Uint8Array.from([0xff, 0xfe, 0x3c, 0x00]));

      await expect(consumeSymposiumAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        "Staged Symposium HTML must be valid UTF-8."
      );
      await expect(readFile(absolutePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("preserves rejected HTML for one targeted correction", async () => {
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      const rejected = '<!doctype html><script></script><img src="https://example.com/pixel">';
      await writeFile(absolutePath, rejected, "utf8");

      await expect(consumeSymposiumAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        `remove unsupported <script>; embed or remove "src" on <img>. Edit this staged file and retry once: ${STAGED_PATH}`
      );
      await expect(readFile(absolutePath, "utf8")).resolves.toBe(rejected);

      await writeFile(absolutePath, "<!doctype html><p>Corrected</p>", "utf8");
      const handoff = await consumeSymposiumAgentHandoff(vaultRoot, STAGED_PATH);
      await expect(readFile(absolutePath)).rejects.toMatchObject({ code: "ENOENT" });
      await handoff.cleanup();
    });

    it("rejects an oversized artifact before reading and still removes it", async () => {
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(absolutePath, new Uint8Array(SYMPOSIUM_MAX_HTML_BYTES + 1).fill(0x61));

      await expect(consumeSymposiumAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        `Symposium HTML is ${SYMPOSIUM_MAX_HTML_BYTES + 1} bytes; the limit is ${SYMPOSIUM_MAX_HTML_BYTES} bytes.`
      );
      await expect(readFile(absolutePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("rejects and removes a linked handoff without changing its target", async () => {
      const externalPath = path.join(vaultRoot, "external.html");
      const stagedPath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(externalPath, "external bytes", "utf8");
      await symlink(externalPath, stagedPath);

      await expect(consumeSymposiumAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        "one ordinary .html file inside the vault handoff folder"
      );
      await expect(readFile(stagedPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(externalPath, "utf8")).resolves.toBe("external bytes");
    });

    it("rejects a linked handoff root without changing its target", async () => {
      const handoffRoot = path.join(vaultRoot, ".symposium", "handoffs");
      const externalRoot = path.join(vaultRoot, "external-handoffs");
      const externalPath = path.join(externalRoot, "review.html");
      await rm(handoffRoot, { recursive: true });
      await mkdir(externalRoot);
      await writeFile(externalPath, "external bytes", "utf8");
      await symlink(externalRoot, handoffRoot);

      await expect(consumeSymposiumAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        "ordinary directory inside the current vault"
      );
      await expect(readFile(externalPath, "utf8")).resolves.toBe("external bytes");
    });

    it("rejects paths that do not name one direct HTML handoff", async () => {
      await expect(
        consumeSymposiumAgentHandoff(vaultRoot, ".symposium/handoffs/nested/review.html")
      ).rejects.toThrow("one ordinary .html file inside the vault handoff folder");
    });
  });
});
