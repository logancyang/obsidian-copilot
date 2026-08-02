import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
    it("returns exact UTF-8 bytes and removes the artifact before review", async () => {
      const html = "\uFEFF<!doctype html><p>Résumé</p>\n";
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(absolutePath, new TextEncoder().encode(html));

      await expect(consumeSymposiumAgentHandoff(vaultRoot, STAGED_PATH)).resolves.toBe(html);
      await expect(readFile(absolutePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("rejects invalid UTF-8 and still removes the artifact", async () => {
      const absolutePath = path.join(vaultRoot, ...STAGED_PATH.split("/"));
      await writeFile(absolutePath, Uint8Array.from([0xff, 0xfe, 0x3c, 0x00]));

      await expect(consumeSymposiumAgentHandoff(vaultRoot, STAGED_PATH)).rejects.toThrow(
        "Staged Symposium HTML must be valid UTF-8."
      );
      await expect(readFile(absolutePath)).rejects.toMatchObject({ code: "ENOENT" });
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
