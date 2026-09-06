import { runInNewContext } from "node:vm";
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { consumeOpenArtifactsAgentHandoff } from "@/openArtifacts/openArtifactsAgentHandoff";
import { OPENARTIFACTS_MAX_HTML_BYTES } from "@/openArtifacts/constants";

const STAGED_PATH = ".openartifacts/handoffs/review.html";

function renderPreviewShell(html: string): { shell: Document; content: Document } {
  const shell = new DOMParser().parseFromString(html, "text/html");
  const frame = shell.querySelector("iframe")!;
  let content = new DOMParser().parseFromString("<body></body>", "text/html");
  Object.defineProperty(frame, "contentDocument", { get: () => content });
  runInNewContext(shell.querySelector("script")!.textContent!, { document: shell });
  frame.dispatchEvent(new Event("load"));
  expect(content.body.childNodes).toHaveLength(0);
  content = new DOMParser().parseFromString(frame.getAttribute("srcdoc")!, "text/html");
  frame.dispatchEvent(new Event("load"));
  const childCount = content.body.childNodes.length;
  frame.dispatchEvent(new Event("load"));
  expect(content.body.childNodes).toHaveLength(childCount);
  return { shell, content };
}

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
      const { shell: parsedPreview, content } = renderPreviewShell(browserPreview);
      const frame = parsedPreview.querySelector("iframe");
      expect(frame?.getAttribute("sandbox")).toBe("allow-same-origin");
      expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
      expect(content.body.innerHTML).toContain('<p data-label="A &amp; B">Résumé</p>');
      expect(parsedPreview.querySelectorAll("iframe")).toHaveLength(1);
      expect(frame?.getAttribute("srcdoc")).toContain("script-src 'none'");
      for (const document of [parsedPreview, content]) {
        expect(document.querySelector('meta[name="viewport"]')?.getAttribute("content")).toBe(
          "width=device-width, initial-scale=1"
        );
      }
      expect(
        parsedPreview
          .querySelector('meta[http-equiv="Content-Security-Policy"]')
          ?.getAttribute("content")
      ).toContain("connect-src 'none'");
      await expect(handoff.isPreviewCurrent()).resolves.toBe(true);
      await expect(readFile(absolutePath)).resolves.toBeDefined();

      await rm(handoff.previewPath);
      await writeFile(handoff.previewPath, "changed bytes", "utf8");
      await expect(handoff.isPreviewCurrent()).resolves.toBe(false);

      await handoff.cleanup();
      await expect(readFile(handoff.previewPath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3121 isolates active content and navigation only in the preview while preserving uploaded HTML", async () => {
      const html = `<noscript><a href="https://example.com">No script</a></noscript><meta http-equiv="refresh" content="0;url=https://example.com"><script>window.exfiltrate()</script><a href="https://example.com">Link</a><svg><a xlink:href="https://example.com"><set attributeName="href" to="https://example.com" /></a></svg><template shadowrootmode="open"><a href="https://example.com">Hidden</a></template><form action="https://example.com"><button formaction="https://example.com">Go</button></form><style>@import "https://example.com/style.css";</style>`;
      await writeFile(path.join(vaultRoot, ...STAGED_PATH.split("/")), html);
      const handoff = await consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH);
      expect(handoff.html).toBe(html);
      const { shell, content } = renderPreviewShell(await readFile(handoff.previewPath, "utf8"));
      expect(shell.querySelectorAll("script")).toHaveLength(1);
      expect(shell.querySelector("iframe")!.getAttribute("sandbox")).toBe("allow-same-origin");
      expect(
        content.querySelectorAll("[href], [action], [formaction], set, template, noscript")
      ).toHaveLength(0);
      expect(content.querySelectorAll("meta")).toHaveLength(3);
      const policy = content
        .querySelector('meta[http-equiv="Content-Security-Policy"]')!
        .getAttribute("content");
      for (const directive of [
        "default-src 'none'",
        "script-src 'none'",
        "connect-src 'none'",
        "frame-src 'none'",
        "form-action 'none'",
      ])
        expect(policy).toContain(directive);
      await handoff.cleanup();
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3121 adopts sanitized nodes without reparsing malformed MathML into a navigable link", async () => {
      const html =
        '<math><mtext><table><mglyph><style><!--</style><img title="--><a href=https://example.invalid/leak>leak</a>">';
      await writeFile(path.join(vaultRoot, ...STAGED_PATH.split("/")), html);
      const handoff = await consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH);
      const { content } = renderPreviewShell(await readFile(handoff.previewPath, "utf8"));
      expect(content.querySelectorAll("a[href], meta[http-equiv=refresh]")).toHaveLength(0);
      expect(handoff.html).toBe(html);
      await handoff.cleanup();
    });

    it("reopens the same HTML after the first preview is closed", async () => {
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      const html = "<!doctype html><p>Review me again</p>";
      await writeFile(absolutePath, html, "utf8");
      const first = await consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH);
      await first.cleanup();
      await expect(readFile(first.previewPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(absolutePath, "utf8")).resolves.toBe(html);
      const second = await consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH);
      expect(second.html).toBe(html);
      expect(second.previewPath).not.toBe(first.previewPath);
      await expect(second.isPreviewCurrent()).resolves.toBe(true);
      await second.cleanup();
      await expect(readFile(absolutePath, "utf8")).resolves.toBe(html);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3121 discards only the captured artifact and preserves modified or replaced files", async () => {
      const stagedPath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(stagedPath, "<p>original</p>");
      const first = await consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH);
      await first.discard();
      await expect(readFile(stagedPath)).rejects.toMatchObject({ code: "ENOENT" });
      await first.discard();
      await first.cleanup();
      for (const replace of [false, true]) {
        await writeFile(stagedPath, "<p>original</p>");
        const handoff = await consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH);
        if (replace) await rm(stagedPath);
        await writeFile(stagedPath, "<p>new artifact</p>");
        await handoff.discard();
        await expect(readFile(stagedPath, "utf8")).resolves.toBe("<p>new artifact</p>");
        await handoff.cleanup();
      }
    });

    it("reports a missing file with the path and a regeneration instruction", async () => {
      await expect(consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        `The staged HTML file was not found: ${STAGED_PATH}. Regenerate the HTML before reopening review.`
      );
    });

    it("rejects invalid UTF-8 without deleting the artifact", async () => {
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(absolutePath, Uint8Array.from([0xff, 0xfe, 0x3c, 0x00]));

      await expect(consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        "Staged OpenArtifacts HTML must be valid UTF-8."
      );
      await expect(readFile(absolutePath)).resolves.toBeDefined();
    });

    it("accepts scripts, external resources, and CSS escapes without changing the page", async () => {
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      const html = String.raw`<!doctype html><link rel="stylesheet" href="https://example.com/style.css"><style>p::before{content:"\00b7"}</style><script>document.body.dataset.ready="yes"</script><iframe src="https://example.com"></iframe><form action="https://example.com"><input></form><img src="https://example.com/image.png">`;
      await writeFile(absolutePath, html, "utf8");
      const handoff = await consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH);
      expect(handoff.html).toBe(html);
      const { content } = renderPreviewShell(await readFile(handoff.previewPath, "utf8"));
      expect(content.body.innerHTML).toContain('content:"\\00b7"');
      expect(content.querySelector("script")).toBeNull();
      await handoff.cleanup();
    });

    it("rejects an oversized artifact before reading without deleting it", async () => {
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(absolutePath, new Uint8Array(OPENARTIFACTS_MAX_HTML_BYTES + 1).fill(0x61));

      await expect(consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        `OpenArtifacts HTML is ${OPENARTIFACTS_MAX_HTML_BYTES + 1} bytes; the limit is ${OPENARTIFACTS_MAX_HTML_BYTES} bytes.`
      );
      await expect(readFile(absolutePath)).resolves.toBeDefined();
    });

    it("rejects a linked handoff without changing its target", async () => {
      const externalPath = path.join(vaultRoot, "external.html");
      const stagedPath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(externalPath, "external bytes", "utf8");
      await symlink(externalPath, stagedPath);

      await expect(consumeOpenArtifactsAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        "one ordinary .html file inside the vault handoff folder"
      );
      await expect(readlink(stagedPath)).resolves.toBe(externalPath);
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
