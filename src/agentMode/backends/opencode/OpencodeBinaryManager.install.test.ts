import { OpencodeBinaryManager } from "./OpencodeBinaryManager";
import { OPENCODE_PINNED_VERSION } from "./ui/opencodeVersion";
import { extractArchive } from "@/agentMode/backends/shared/extractArchive";
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
jest.mock("@/agentMode/backends/shared/extractArchive", () => ({ extractArchive: jest.fn() }));
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
      jest.mocked(requestUrl).mockResolvedValue({
        status: 200,
        json: {
          assets: [
            {
              name: "opencode-darwin-arm64.zip",
              browser_download_url: "https://example.invalid/release.zip",
            },
          ],
        },
      } as never);
      jest.mocked(https.get).mockImplementation(((
        _url: string,
        callback: (response: unknown) => void
      ) => {
        const response = Object.assign(Readable.from([Buffer.from("archive")]), {
          statusCode: 200,
          headers: {},
        });
        callback(response);
        return new EventEmitter();
      }) as never);
      jest.mocked(extractArchive).mockImplementation(async (_archive, destination) => {
        fs.writeFileSync(
          path.join(destination, "opencode"),
          `#!${process.execPath}\nprocess.stdout.write("${OPENCODE_PINNED_VERSION}");\n`
        );
      });
    });
    afterEach(() => {
      jest.restoreAllMocks();
      fs.rmSync(root, { recursive: true, force: true });
    });
    describe("install()", () => {
      it(`${issue} verifies the staged executable before selecting the pinned installation`, async () => {
        const result = await manager.install();
        expect(result.version).toBe(OPENCODE_PINNED_VERSION);
        expect(result.path).toBe(previous);
        expect(fs.readFileSync(result.path, "utf8")).toContain(OPENCODE_PINNED_VERSION);
        expect(getSettings().agentMode.backends?.opencode?.binaryPath).toBe(result.path);
      });
      it(`${issue} rejects a runnable download reporting the wrong version`, async () => {
        jest.mocked(extractArchive).mockImplementation(async (_archive, destination) => {
          fs.writeFileSync(
            path.join(destination, "opencode"),
            `#!${process.execPath}\nprocess.stdout.write("0.0.1");\n`
          );
        });
        await expect(manager.install()).rejects.toThrow("did not report version");
        expect(fs.readFileSync(previous, "utf8")).toBe("running process executable");
        expect(getSettings().agentMode.backends?.opencode?.binaryPath).toBe(previous);
      });
      it(`${issue} rejects a broken staged executable without replacing the published directory or pointer`, async () => {
        jest.mocked(extractArchive).mockImplementation(async (_archive, destination) => {
          fs.writeFileSync(path.join(destination, "opencode"), "broken binary");
        });
        await expect(manager.install()).rejects.toThrow();
        expect(fs.readFileSync(previous, "utf8")).toBe("running process executable");
        expect(getSettings().agentMode.backends?.opencode?.binaryPath).toBe(previous);
      });
    });
  });
});
