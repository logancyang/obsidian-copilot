import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { consumeOpenArtifactsAgentHandoff } from "@/openArtifacts/openArtifactsAgentHandoff";
import { OPENARTIFACTS_MAX_HTML_BYTES } from "@/openArtifacts/constants";

const STAGED_PATH = ".openartifacts/handoffs/review.html";

describe("openArtifactsAgentHandoff", () => {
  let vaultRoot: string;

  beforeEach(async () => {
    vaultRoot = await mkdtemp(path.join(tmpdir(), "openartifacts-handoff-"));
    await mkdir(path.join(vaultRoot, ".openartifacts", "handoffs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(vaultRoot, { recursive: true, force: true });
  });

  describe("consumeOpenArtifactsAgentHandoff()", () => {
    it("wraps exact UTF-8 bytes in a verifiable sandboxed browser preview", async () => {
      const html = '\uFEFF<!doctype html><p data-label="A & B">Résumé</p>\n';
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(absolutePath, new TextEncoder().encode(html));

      const handoff = await consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH);

      expect(Object.isFrozen(handoff)).toBe(true);
      expect(handoff.html).toBe(html);
      expect(handoff.previewUrl).toBe(pathToFileURL(handoff.previewPath).href);
      const browserPreview = await readFile(handoff.previewPath, "utf8");
      const parsedPreview = new DOMParser().parseFromString(browserPreview, "text/html");
      const frame = parsedPreview.querySelector("iframe");
      expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
      expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
      expect(frame?.getAttribute("srcdoc")).toBe(html);
      expect(parsedPreview.querySelectorAll("iframe")).toHaveLength(1);
      expect(parsedPreview.querySelector("script")).toBeNull();
      expect(parsedPreview.querySelector('meta[http-equiv="Content-Security-Policy"]')).toBeNull();
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

      await expect(consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        "Staged OpenArtifacts HTML must be valid UTF-8."
      );
      await expect(readFile(absolutePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("accepts scripts, external resources, and CSS escapes without changing the page", async () => {
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      const html = String.raw`<!doctype html><link rel="stylesheet" href="https://example.com/style.css"><style>p::before{content:"\00b7"}</style><script>document.body.dataset.ready="yes"</script><iframe src="https://example.com"></iframe><form action="https://example.com"><input></form><img src="https://example.com/image.png">`;
      await writeFile(absolutePath, html, "utf8");
      const handoff = await consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH);
      expect(handoff.html).toBe(html);
      const preview = new DOMParser().parseFromString(
        await readFile(handoff.previewPath, "utf8"),
        "text/html"
      );
      expect(preview.querySelector("iframe")?.getAttribute("srcdoc")).toBe(html);
      await handoff.cleanup();
    });

    it("rejects an oversized artifact before reading and still removes it", async () => {
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(absolutePath, new Uint8Array(OPENARTIFACTS_MAX_HTML_BYTES + 1).fill(0x61));

      await expect(consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        `OpenArtifacts HTML is ${OPENARTIFACTS_MAX_HTML_BYTES + 1} bytes; the limit is ${OPENARTIFACTS_MAX_HTML_BYTES} bytes.`
      );
      await expect(readFile(absolutePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("rejects and removes a linked handoff without changing its target", async () => {
      const externalPath = path.join(vaultRoot, "external.html");
      const stagedPath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(externalPath, "external bytes", "utf8");
      await symlink(externalPath, stagedPath);

      await expect(consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        "one ordinary .html file inside the vault handoff folder"
      );
      await expect(readFile(stagedPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(externalPath, "utf8")).resolves.toBe("external bytes");
    });

    it("rejects a linked handoff root without changing its target", async () => {
      const handoffRoot = path.join(vaultRoot, ".openartifacts", "handoffs");
      const externalRoot = path.join(vaultRoot, "external-handoffs");
      const externalPath = path.join(externalRoot, "review.html");
      await rm(handoffRoot, { recursive: true });
      await mkdir(externalRoot);
      await writeFile(externalPath, "external bytes", "utf8");
      await symlink(externalRoot, handoffRoot);

      await expect(consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        "ordinary directory inside the current vault"
      );
      await expect(readFile(externalPath, "utf8")).resolves.toBe("external bytes");
    });

    it("rejects paths that do not name one direct HTML handoff", async () => {
      await expect(
        consumeOpenArtifactsAgentHandoff(vaultRoot, ".openartifacts/handoffs/nested/review.html")
      ).rejects.toThrow("one ordinary .html file inside the vault handoff folder");
    });
  });
});
