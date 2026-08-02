import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { consumeSymposiumAgentHandoff } from "@/agentMode/symposium/symposiumAgentHandoff";
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
    it("returns the exact valid UTF-8 bytes and leaves deletion to the wrapper", async () => {
      const html = "\uFEFF<!doctype html><p>Résumé</p>\n";
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(absolutePath, new TextEncoder().encode(html));

      await expect(consumeSymposiumAgentHandoff(vaultRoot, STAGED_PATH)).resolves.toBe(html);
      await expect(readFile(absolutePath)).resolves.toEqual(Buffer.from(html));
    });

    it("rejects invalid UTF-8 without deleting through host privileges", async () => {
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(absolutePath, Uint8Array.from([0xff, 0xfe, 0x3c, 0x00]));

      await expect(consumeSymposiumAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        "Staged Symposium HTML must be valid UTF-8."
      );
      await expect(readFile(absolutePath)).resolves.toEqual(
        Buffer.from(Uint8Array.from([0xff, 0xfe, 0x3c, 0x00]))
      );
    });

    it("rejects an oversized artifact before allocating its contents", async () => {
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(absolutePath, new Uint8Array(SYMPOSIUM_MAX_HTML_BYTES + 1).fill(0x61));

      await expect(consumeSymposiumAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        `Symposium HTML is ${SYMPOSIUM_MAX_HTML_BYTES + 1} bytes; the limit is ${SYMPOSIUM_MAX_HTML_BYTES} bytes.`
      );
      await expect(readFile(absolutePath)).resolves.toHaveLength(SYMPOSIUM_MAX_HTML_BYTES + 1);
    });

    it("rejects a symlink without reading or deleting its external target", async () => {
      const externalPath = path.join(vaultRoot, "external.html");
      const stagedPath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(externalPath, "external bytes", "utf8");
      await symlink(externalPath, stagedPath);

      await expect(consumeSymposiumAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        "ordinary file inside the vault handoff folder"
      );
      await expect(readFile(externalPath, "utf8")).resolves.toBe("external bytes");
    });

    it("rejects a hard-linked file without deleting its external target", async () => {
      const externalPath = path.join(vaultRoot, "external.html");
      const stagedPath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(externalPath, "external bytes", "utf8");
      await link(externalPath, stagedPath);

      await expect(consumeSymposiumAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        "ordinary file inside the vault handoff folder"
      );
      await expect(readFile(externalPath, "utf8")).resolves.toBe("external bytes");
    });

    it("rejects a symlinked handoff directory without deleting its target", async () => {
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
  });
});
