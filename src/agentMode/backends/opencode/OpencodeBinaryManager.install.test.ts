import * as opencodeVersion from "./ui/opencodeVersion";
import { OpencodeBinaryManager } from "./OpencodeBinaryManager";
import { OPENCODE_PINNED_VERSION } from "./ui/opencodeVersion";
import * as npmPackage from "./npmPackage";
import { getSettings, updateAgentModeBackendFields } from "@/settings/model";
import { requestUrl } from "obsidian";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as https from "https";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

jest.mock("https", () => ({ get: jest.fn() }));
jest.mock("obsidian", () => ({ ...jest.requireActual("obsidian"), requestUrl: jest.fn() }));
jest.mock("./npmPackage", () => ({
  resolveNpmAsset: jest.fn(),
  verifyNpmIntegrity: jest.fn(),
  extractNpmBinary: jest.fn(),
}));
jest.mock("./platformResolver", () => ({
  resolveOpencodeTarget: async () => ({
    target: { platform: "darwin", arch: "arm64" },
    candidates: ["opencode-darwin-arm64"],
  }),
  expectedBinaryName: () => "opencode",
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/530";
(process.platform === "win32" ? describe.skip : describe)("OpencodeBinaryManager.install", () => {
  describe("OpencodeBinaryManager", () => {
    let root: string;
    let manager: OpencodeBinaryManager;
    let previous: string;
    beforeEach(() => {
      jest.mocked(npmPackage.resolveNpmAsset).mockReset();
      jest.mocked(npmPackage.verifyNpmIntegrity).mockReset();
      jest.mocked(npmPackage.extractNpmBinary).mockReset();
      root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-publication-"));
      manager = new OpencodeBinaryManager({} as never);
      jest.spyOn(manager, "getDataDir").mockReturnValue(root);
      previous = path.join(root, OPENCODE_PINNED_VERSION, "bin", "opencode");
      fs.mkdirSync(path.dirname(previous), { recursive: true });
      fs.writeFileSync(previous, "running process executable");
      updateAgentModeBackendFields("opencode", {
        binaryPath: previous,
        binaryVersion: "0.1.0",
        binarySource: "managed",
      });
      jest.mocked(https.get).mockImplementation(((
        _url: string,
        _options: unknown,
        callback: (response: unknown) => void
      ) => {
        const response = Object.assign(Readable.from([Buffer.from("archive")]), {
          statusCode: 200,
          headers: { "content-length": String("archive".length) },
        });
        callback(response);
        return Object.assign(new EventEmitter(), { setTimeout: jest.fn() });
      }) as never);
      jest.mocked(npmPackage.resolveNpmAsset).mockResolvedValue({
        name: "cli-darwin-arm64-2.0.14.tgz",
        url: "https://registry.npmjs.org/package.tgz",
        integrity: "sha512-" + Buffer.alloc(64).toString("base64"),
      });
      jest.mocked(npmPackage.extractNpmBinary).mockImplementation(async (_archive, destination) => {
        fs.writeFileSync(destination, `#!${process.execPath}\nprocess.stdout.write("2.0.14");\n`);
      });
    });
    afterEach(() => {
      jest.restoreAllMocks();
      fs.rmSync(root, { recursive: true, force: true });
    });
    describe("install()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/560 installs a verified OpenCode 2 npm binary without a system archive command", async () => {
        const version = "2.0.14";
        const result = await manager.install({ version });
        expect(result.version).toBe(version);
        expect(fs.existsSync(result.path)).toBe(true);
        expect(jest.mocked(npmPackage.resolveNpmAsset)).toHaveBeenCalledWith(
          version,
          ["opencode-darwin-arm64"],
          expect.any(Function),
          expect.any(AbortSignal)
        );
        expect(npmPackage.verifyNpmIntegrity).toHaveBeenCalledWith(
          expect.stringContaining(".tgz"),
          expect.stringMatching(/^sha512-/),
          expect.any(AbortSignal)
        );
        expect(npmPackage.extractNpmBinary).toHaveBeenCalled();
        expect(getSettings().agentMode.backends?.opencode?.binaryPath).toBe(result.path);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/560 leaves a working install selected when npm integrity verification fails", async () => {
        jest
          .mocked(npmPackage.verifyNpmIntegrity)
          .mockRejectedValue(new Error("OpenCode npm download integrity mismatch"));
        await expect(manager.install({ version: "2.0.14" })).rejects.toThrow(/integrity mismatch/);
        expect(npmPackage.extractNpmBinary).not.toHaveBeenCalled();
        expect(fs.readFileSync(previous, "utf8")).toBe("running process executable");
        expect(getSettings().agentMode.backends?.opencode?.binaryPath).toBe(previous);
      });
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/535 rejects a managed pin below minimum without downloading or replacing the selected installation", async () => {
        const selected = { ...getSettings().agentMode.backends?.opencode };
        jest.mocked(requestUrl).mockClear();
        const minimum = jest.replaceProperty<
          { OPENCODE_MIN_VERSION: string },
          "OPENCODE_MIN_VERSION"
        >(opencodeVersion, "OPENCODE_MIN_VERSION", "999.0.0");
        try {
          await expect(manager.install()).rejects.toThrow("requires");
          expect(requestUrl).not.toHaveBeenCalled();
          expect(getSettings().agentMode.backends?.opencode).toEqual(selected);
          expect(fs.readFileSync(previous, "utf8")).toBe("running process executable");
        } finally {
          minimum.restore();
        }
      });
      it(`${issue} verifies the staged OpenCode 2 executable before selecting it`, async () => {
        const result = await manager.install({ version: "2.0.14" });
        expect(result.version).toBe("2.0.14");
        expect(result.path).not.toBe(previous);
        expect(fs.readFileSync(result.path, "utf8")).toContain("2.0.14");
        expect(getSettings().agentMode.backends?.opencode?.binaryPath).toBe(result.path);
      });
      it(`${issue} rejects a runnable download reporting the wrong version`, async () => {
        jest
          .mocked(npmPackage.extractNpmBinary)
          .mockImplementation(async (_archive, destination) => {
            fs.writeFileSync(
              destination,
              `#!${process.execPath}\nprocess.stdout.write("0.0.1");\n`
            );
          });
        await expect(manager.install({ version: "2.0.14" })).rejects.toThrow(
          "did not report version"
        );
        expect(fs.readFileSync(previous, "utf8")).toBe("running process executable");
        expect(getSettings().agentMode.backends?.opencode?.binaryPath).toBe(previous);
      });
      it(`${issue} rejects a broken staged executable without replacing the published directory or pointer`, async () => {
        jest
          .mocked(npmPackage.extractNpmBinary)
          .mockImplementation(async (_archive, destination) => {
            fs.writeFileSync(destination, "broken binary");
          });
        await expect(manager.install({ version: "2.0.14" })).rejects.toThrow();
        expect(fs.readFileSync(previous, "utf8")).toBe("running process executable");
        expect(getSettings().agentMode.backends?.opencode?.binaryPath).toBe(previous);
      });
    });
  });
});
