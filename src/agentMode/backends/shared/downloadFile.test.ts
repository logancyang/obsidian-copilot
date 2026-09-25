import { downloadFile } from "@/agentMode/backends/shared/downloadFile";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";

const mockGet = jest.fn();
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: (id: string) =>
    id === "https" ? { get: mockGet } : jest.requireActual(`node:${id}`),
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/578";
const BYTES = Buffer.from("managed release archive");
const SHA256 = createHash("sha256").update("managed release archive").digest("hex");

interface FakeResponse {
  statusCode: number;
  headers?: Record<string, string>;
  chunks?: Buffer[];
}

/** Serves one scripted response per request, in order. */
function serve(...responses: FakeResponse[]): void {
  mockGet.mockImplementation((_url, _options, callback) => {
    const next = responses.shift()!;
    const body = Readable.from(next.chunks ?? []);
    Object.assign(body, { statusCode: next.statusCode, headers: next.headers ?? {} });
    callback(body);
    return Object.assign(new EventEmitter(), { setTimeout: jest.fn(), destroy: jest.fn() });
  });
}

describe("downloadFile", () => {
  describe("downloadFile()", () => {
    let dir: string;
    let dest: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "download-file-"));
      dest = path.join(dir, "asset.zip");
      mockGet.mockReset();
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const download = (overrides: { bytes?: number; sha256?: string; signal?: AbortSignal } = {}) =>
      downloadFile("https://example.test/asset.zip", dest, {
        displayName: "Agent",
        bytes: BYTES.length,
        sha256: SHA256,
        signal: new AbortController().signal,
        ...overrides,
      });

    it(`writes a verified asset and reports bytes as each whole percent arrives: ${ISSUE}`, async () => {
      const midpoint = Math.floor(BYTES.length / 2);
      serve({ statusCode: 200, chunks: [BYTES.subarray(0, midpoint), BYTES.subarray(midpoint)] });
      const progress: Array<[number, number]> = [];

      await downloadFile("https://example.test/asset.zip", dest, {
        displayName: "Agent",
        bytes: BYTES.length,
        sha256: SHA256,
        signal: new AbortController().signal,
        onProgress: (received, total) => progress.push([received, total]),
      });

      expect(fs.readFileSync(dest)).toEqual(BYTES);
      expect(progress).toEqual([
        [0, BYTES.length],
        [midpoint, BYTES.length],
        [BYTES.length, BYTES.length],
      ]);
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 follows HTTPS redirects to the published asset", async () => {
      serve(
        { statusCode: 302, headers: { location: "https://cdn.example.test/asset.zip" } },
        { statusCode: 200, chunks: [BYTES] }
      );

      await download();

      expect(mockGet.mock.calls.map(([url]) => url)).toEqual([
        "https://example.test/asset.zip",
        "https://cdn.example.test/asset.zip",
      ]);
      expect(fs.readFileSync(dest)).toEqual(BYTES);
    });
    it("accepts an asset without a published digest when its size matches", async () => {
      serve({ statusCode: 200, chunks: [BYTES] });

      await download({ sha256: undefined });

      expect(fs.readFileSync(dest)).toEqual(BYTES);
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 rejects a redirect that leaves HTTPS before requesting it", async () => {
      serve({ statusCode: 302, headers: { location: "http://example.test/asset.zip" } });

      await expect(download()).rejects.toThrow("Unsafe Agent download redirect.");
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
    it("names the HTTP status of a failed response", async () => {
      serve({ statusCode: 404 });

      await expect(download()).rejects.toThrow("Agent download failed: HTTP 404");
    });
    it.each([
      ["larger", BYTES.length - 1],
      ["smaller", BYTES.length + 1],
    ])("rejects an asset %s than its published size", async (_case, bytes) => {
      serve({ statusCode: 200, chunks: [BYTES] });

      await expect(download({ bytes })).rejects.toThrow("Agent download size mismatch.");
    });
    it("rejects an asset whose digest differs from the published one", async () => {
      serve({ statusCode: 200, chunks: [BYTES] });

      await expect(download({ sha256: "0".repeat(64) })).rejects.toThrow(
        "Agent download checksum mismatch."
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 reports cancellation instead of a network error when aborted mid-transfer", async () => {
      const controller = new AbortController();
      mockGet.mockImplementation((_url, _options, callback) => {
        let reads = 0;
        const body = new Readable({
          read() {
            if (reads++ === 0) {
              this.push(BYTES.subarray(0, 4));
              return;
            }
            controller.abort();
            this.destroy(new Error("socket hang up"));
          },
        });
        Object.assign(body, { statusCode: 200, headers: {} });
        callback(body);
        return Object.assign(new EventEmitter(), { setTimeout: jest.fn(), destroy: jest.fn() });
      });

      await expect(download({ signal: controller.signal })).rejects.toMatchObject({
        name: "AbortError",
      });
    });
    it("does not connect when already cancelled", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(download({ signal: controller.signal })).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(mockGet).not.toHaveBeenCalled();
    });
  });
});
