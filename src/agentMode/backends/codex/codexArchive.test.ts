import { installCodexArchive, CODEX_BUNDLE_VERSION } from "./codexArchive";
import { zipSync, strToU8 } from "fflate";
import { requestUrl } from "obsidian";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

const mockGet = jest.fn();
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: (id: string) =>
    id === "https" ? { get: mockGet } : jest.requireActual(`node:${id}`),
}));
jest.mock("obsidian", () => ({ requestUrl: jest.fn() }));
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/379";

describe("codexArchive", () => {
  describe("installCodexArchive()", () => {
    let stage: string;
    const target = `${process.platform}-${process.arch}`;
    const stem = `codex-acp-v${CODEX_BUNDLE_VERSION}-${target}`;
    let bytes: Uint8Array;
    let manifest: Record<string, unknown>;
    beforeEach(() => {
      stage = fs.mkdtempSync(path.join(os.tmpdir(), "codex-archive-"));
      bytes = zipSync({
        [`${stem}/codex-acp`]: new Uint8Array(strToU8("native")),
        [`${stem}/codex-runtime/codex`]: new Uint8Array(strToU8("runtime")),
      });
      manifest = {
        archive: `${stem}.zip`,
        target,
        acpVersion: "1.10.0",
        packagingRevision: 1,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        archiveBytes: bytes.length,
        extractedBytes: 13,
      };
      jest
        .mocked(requestUrl)
        .mockImplementation(() => Promise.resolve({ json: manifest }) as never);
      mockGet.mockReset().mockImplementation((_url, _options, callback) => {
        const response = Readable.from([Buffer.from(bytes)]);
        Object.assign(response, { statusCode: 200 });
        callback(response);
        return Object.assign(new EventEmitter(), { setTimeout: jest.fn(), destroy: jest.fn() });
      });
    });
    afterEach(() => fs.rmSync(stage, { recursive: true, force: true }));
    (process.env.CODEX_BUNDLE_TEST_ARCHIVE ? it : it.skip)(
      `extracts and launches the locally built full archive with no external runtime: ${ISSUE}`,
      async () => {
        const archive = process.env.CODEX_BUNDLE_TEST_ARCHIVE!;
        manifest = JSON.parse(fs.readFileSync(archive.replace(/\.zip$/, ".json"), "utf8"));
        mockGet.mockImplementation((_url, _options, callback) => {
          const response = fs.createReadStream(archive);
          Object.assign(response, { statusCode: 200 });
          callback(response);
          return Object.assign(new EventEmitter(), { setTimeout: jest.fn(), destroy: jest.fn() });
        });
        await installCodexArchive(stage, new AbortController().signal);
        const { execFileSync } =
          jest.requireActual<typeof import("node:child_process")>("node:child_process");
        const home = path.join(stage, "isolated-home");
        fs.mkdirSync(home);
        const output = execFileSync(path.join(stage, "codex-acp"), ["cli", "--help"], {
          env: { HOME: home, CODEX_HOME: home, PATH: "" },
          encoding: "utf8",
          timeout: 20_000,
        });
        expect(output).toContain("Codex CLI");
      },
      60_000
    );
    it(`extracts the full runtime only after verifying the trusted pinned archive: ${ISSUE}`, async () => {
      await installCodexArchive(stage, new AbortController().signal);
      expect(fs.readFileSync(path.join(stage, "codex-runtime/codex"), "utf8")).toBe("runtime");
      expect(fs.existsSync(path.join(stage, "download.zip"))).toBe(false);
      expect(requestUrl).toHaveBeenCalledWith(
        `https://github.com/Brevilabs/codex-acp-binary/releases/download/v${CODEX_BUNDLE_VERSION}/${stem}.json`
      );
    });
    it.each(["checksum", "size", "pin", "extracted size"])(
      `rejects a %s mismatch without extracting an executable: ${ISSUE}`,
      async (fault) => {
        if (fault === "checksum") manifest.sha256 = "0".repeat(64);
        if (fault === "size") manifest.archiveBytes = bytes.length - 1;
        if (fault === "pin") manifest.packagingRevision = 2;
        if (fault === "extracted size") manifest.extractedBytes = 1;
        await expect(installCodexArchive(stage, new AbortController().signal)).rejects.toThrow();
        if (fault !== "extracted size")
          expect(fs.existsSync(path.join(stage, "codex-acp"))).toBe(false);
      }
    );
    it(`rejects ZIP traversal before writing outside the stage: ${ISSUE}`, async () => {
      bytes = zipSync({ [`${stem}/../escaped`]: new Uint8Array(strToU8("no")) });
      Object.assign(manifest, {
        archiveBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        extractedBytes: 2,
      });
      await expect(installCodexArchive(stage, new AbortController().signal)).rejects.toThrow(
        "Unsafe"
      );
      expect(fs.existsSync(path.join(stage, "../escaped"))).toBe(false);
    });
    it(`honors cancellation before downloading: ${ISSUE}`, async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(installCodexArchive(stage, controller.signal)).rejects.toThrow("Aborted");
      expect(mockGet).not.toHaveBeenCalled();
    });
  });
});
