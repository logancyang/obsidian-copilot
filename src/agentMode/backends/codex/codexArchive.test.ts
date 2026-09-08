import { installCodexArchive, CODEX_BUNDLE_VERSION } from "./codexArchive";
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
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    let stem: string;
    let bytes: Uint8Array;
    let manifest: Record<string, unknown>;
    beforeEach(() => {
      stage = fs.mkdtempSync(path.join(os.tmpdir(), "codex-archive-"));
      const target = `${process.platform}-${process.arch}`;
      stem = `codex-acp-v${CODEX_BUNDLE_VERSION}-${target}`;
      const extension = process.platform === "linux" ? ".tar.gz" : ".zip";
      bytes = new Uint8Array(
        fs.readFileSync(path.join(__dirname, "__fixtures__", `runtime${extension}`))
      );
      manifest = {
        archive: `${stem}${extension}`,
        target,
        acpVersion: "1.10.0",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        archiveBytes: bytes.length,
        extractedBytes: 13,
      };
      jest
        .mocked(requestUrl)
        .mockReset()
        .mockImplementation(() => Promise.resolve({ json: manifest }) as never);
      mockGet.mockReset().mockImplementation((_url, _options, callback) => {
        const response = Readable.from([Buffer.from(bytes)]);
        Object.assign(response, { statusCode: 200 });
        callback(response);
        return Object.assign(new EventEmitter(), { setTimeout: jest.fn(), destroy: jest.fn() });
      });
    });
    afterEach(() => {
      Object.defineProperty(process, "platform", platform);
      jest.restoreAllMocks();
      fs.rmSync(stage, { recursive: true, force: true });
    });
    (process.env.CODEX_BUNDLE_TEST_ARCHIVE ? it : it.skip)(
      `extracts and launches the locally built full archive with no external runtime: ${ISSUE}`,
      async () => {
        const archive = process.env.CODEX_BUNDLE_TEST_ARCHIVE!;
        manifest = JSON.parse(
          fs.readFileSync(archive.replace(/\.(zip|tar\.gz)$/, ".json"), "utf8")
        );
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
        const executable = process.platform === "win32" ? "codex-acp.exe" : "codex-acp";
        const output = execFileSync(path.join(stage, executable), ["cli", "--help"], {
          env: { HOME: home, CODEX_HOME: home, PATH: "" },
          encoding: "utf8",
          timeout: 20_000,
        });
        expect(output).toContain("Codex CLI");
      },
      60_000
    );
    it.each(process.platform === "linux" ? [".tar.gz"] : [".zip", ".tar.gz"])(
      `extracts the full runtime from %s after verifying the pinned archive: ${ISSUE}`,
      async (extension) => {
        if (extension === ".tar.gz") Object.defineProperty(process, "platform", { value: "linux" });
        const target = `${process.platform}-${process.arch}`;
        stem = `codex-acp-v${CODEX_BUNDLE_VERSION}-${target}`;
        bytes = new Uint8Array(
          fs.readFileSync(path.join(__dirname, "__fixtures__", `runtime${extension}`))
        );
        Object.assign(manifest, {
          target,
          archive: `${stem}${extension}`,
          archiveBytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
        await installCodexArchive(stage, new AbortController().signal);
        expect(fs.readFileSync(path.join(stage, "codex-runtime/codex"), "utf8")).toBe("runtime");
        expect(fs.existsSync(path.join(stage, manifest.archive as string))).toBe(false);
        expect(requestUrl).toHaveBeenCalledWith(
          `https://github.com/Brevilabs/codex-acp-binary/releases/download/v${CODEX_BUNDLE_VERSION}/${stem}.json`
        );
      }
    );
    it.each(["linux", "darwin", "win32"])(
      `downloads the published archive format for %s: ${ISSUE}`,
      async (targetPlatform) => {
        Object.defineProperty(process, "platform", { value: targetPlatform });
        const target = `${targetPlatform}-${process.arch}`;
        const extension = targetPlatform === "linux" ? ".tar.gz" : ".zip";
        bytes = new Uint8Array(
          fs.readFileSync(path.join(__dirname, "__fixtures__", `runtime${extension}`))
        );
        Object.assign(manifest, {
          target,
          archive: `codex-acp-v${CODEX_BUNDLE_VERSION}-${target}${extension}`,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          archiveBytes: bytes.length,
        });
        // GNU tar cannot read ZIP; native ZIP extraction is exercised on macOS/Windows.
        const extractor = jest
          .spyOn(
            jest.requireActual<typeof import("@/agentMode/backends/shared/extractArchive")>(
              "@/agentMode/backends/shared/extractArchive"
            ),
            "extractArchive"
          )
          .mockResolvedValue();
        await installCodexArchive(stage, new AbortController().signal);
        expect(mockGet.mock.calls[0][0]).toBe(
          `https://github.com/Brevilabs/codex-acp-binary/releases/download/v${CODEX_BUNDLE_VERSION}/${manifest.archive as string}`
        );
        expect(extractor).toHaveBeenCalledWith(
          path.join(stage, manifest.archive as string),
          stage,
          { signal: expect.anything(), stripComponents: 1 }
        );
      }
    );
    it.each(["checksum", "size", "pin", "archive format"])(
      `rejects a %s mismatch without extracting an executable: ${ISSUE}`,
      async (fault) => {
        if (fault === "checksum") manifest.sha256 = "0".repeat(64);
        if (fault === "size") manifest.archiveBytes = bytes.length - 1;
        if (fault === "pin") manifest.acpVersion = "0.0.0";
        if (fault === "archive format") manifest.archive = "unexpected.zip";
        await expect(installCodexArchive(stage, new AbortController().signal)).rejects.toThrow();
        expect(fs.existsSync(path.join(stage, "codex-acp"))).toBe(false);
      }
    );
    it(`rejects a corrupt archive when tar cannot extract it: ${ISSUE}`, async () => {
      bytes = new Uint8Array(Buffer.from("not an archive"));
      Object.assign(manifest, {
        archiveBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      await expect(installCodexArchive(stage, new AbortController().signal)).rejects.toThrow(
        "tar exited"
      );
    });
    it(`honors cancellation before downloading: ${ISSUE}`, async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(installCodexArchive(stage, controller.signal)).rejects.toThrow("Aborted");
      expect(requestUrl).not.toHaveBeenCalled();
      expect(mockGet).not.toHaveBeenCalled();
    });
  });
});
