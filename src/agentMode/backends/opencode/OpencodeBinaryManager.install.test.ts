import * as opencodeVersion from "./ui/opencodeVersion";
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
import { createHash } from "node:crypto";

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
const digestIssue = "https://github.com/logancyang/obsidian-copilot/issues/2890";
const RELEASE_ARCHIVE = "official release archive";
const sha256Of = (content: string): string => createHash("sha256").update(content).digest("hex");

/** Serves `content` as the response to every download request. */
function serveDownload(content: string): void {
  jest.mocked(https.get).mockImplementation(((
    _url: string,
    callback: (response: unknown) => void
  ) => {
    const response = Object.assign(Readable.from([Buffer.from(content)]), {
      statusCode: 200,
      headers: {},
    });
    callback(response);
    return new EventEmitter();
  }) as never);
}

/** Publishes release metadata whose only asset carries `digest`. */
function publishReleaseAsset(digest: string | null): void {
  jest.mocked(requestUrl).mockResolvedValue({
    status: 200,
    json: {
      assets: [
        {
          name: "opencode-darwin-arm64.zip",
          browser_download_url: "https://example.invalid/release.zip",
          digest,
        },
      ],
    },
  } as never);
}

(process.platform === "win32" ? describe.skip : describe)("OpencodeBinaryManager.install", () => {
  describe("OpencodeBinaryManager", () => {
    let root: string;
    let manager: OpencodeBinaryManager;
    let previous: string;
    beforeEach(() => {
      jest.clearAllMocks();
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
      publishReleaseAsset(`sha256:${sha256Of(RELEASE_ARCHIVE)}`);
      serveDownload(RELEASE_ARCHIVE);
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
      it(`${digestIssue} installs and selects a download whose SHA-256 matches the digest GitHub publishes for the asset`, async () => {
        const extracted: string[] = [];
        jest.mocked(extractArchive).mockImplementation(async (archive, destination) => {
          extracted.push(fs.readFileSync(archive, "utf8"));
          fs.writeFileSync(
            path.join(destination, "opencode"),
            `#!${process.execPath}\nprocess.stdout.write("${OPENCODE_PINNED_VERSION}");\n`
          );
        });

        const result = await manager.install();

        expect(extracted).toEqual([RELEASE_ARCHIVE]);
        expect(result).toEqual({ version: OPENCODE_PINNED_VERSION, path: previous });
        expect(getSettings().agentMode.backends?.opencode).toMatchObject({
          binaryPath: previous,
          binaryVersion: OPENCODE_PINNED_VERSION,
          binarySource: "managed",
        });
      });
      it(`${digestIssue} discards a download whose SHA-256 differs from the published digest without extracting or selecting it`, async () => {
        serveDownload("tampered archive whose executable prints the pinned version");

        await expect(manager.install()).rejects.toThrow(
          "opencode-darwin-arm64.zip does not match the SHA-256 digest GitHub publishes"
        );

        expect(extractArchive).not.toHaveBeenCalled();
        expect(fs.readFileSync(previous, "utf8")).toBe("running process executable");
        expect(getSettings().agentMode.backends?.opencode?.binaryVersion).toBe("0.1.0");
        expect(fs.readdirSync(root)).toEqual([OPENCODE_PINNED_VERSION]);
      });
      it(`${digestIssue} refuses to download a release asset that has no published SHA-256 digest`, async () => {
        publishReleaseAsset(null);

        await expect(manager.install()).rejects.toThrow(
          "GitHub publishes no SHA-256 digest for opencode-darwin-arm64.zip"
        );

        expect(https.get).not.toHaveBeenCalled();
        expect(fs.readFileSync(previous, "utf8")).toBe("running process executable");
        expect(getSettings().agentMode.backends?.opencode?.binaryVersion).toBe("0.1.0");
      });
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
