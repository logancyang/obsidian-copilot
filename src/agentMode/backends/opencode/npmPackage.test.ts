import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { requestUrl, type RequestUrlResponsePromise } from "obsidian";
import { extractNpmBinary, resolveNpmAsset, verifyNpmIntegrity } from "./npmPackage";
import { ManagedInstallAbortError } from "@/agentMode/backends/shared/managedInstall";

jest.mock("obsidian", () => ({ ...jest.requireActual("obsidian"), requestUrl: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/560";

function response(status: number, json: unknown): RequestUrlResponsePromise {
  return { status, json } as unknown as RequestUrlResponsePromise;
}

function joinBytes(...chunks: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

function tarEntry(name: string, content: Uint8Array): Uint8Array {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(content.length.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write("0", 156, 1, "ascii");
  return joinBytes(
    new Uint8Array(header),
    content,
    new Uint8Array((512 - (content.length % 512)) % 512)
  );
}

describe("npmPackage", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-npm-test-"));
  });

  afterEach(async () => {
    jest.mocked(requestUrl).mockReset();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  describe("resolveNpmAsset()", () => {
    const INTEGRITY = "sha512-" + Buffer.alloc(64).toString("base64");

    it(`${ISSUE} resolves the first matching platform package and sha512 integrity`, async () => {
      jest.mocked(requestUrl).mockResolvedValue(
        response(200, {
          dist: {
            tarball:
              "https://registry.npmjs.org/@opencode/cli-linux-x64-musl/-/cli-linux-x64-musl-2.0.14.tgz",
            integrity: INTEGRITY,
          },
        })
      );
      const asset = await resolveNpmAsset("2.0.14", ["opencode-linux-x64-musl"]);
      expect(requestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://registry.npmjs.org/@opencode%2Fcli-linux-x64-musl/2.0.14",
        })
      );
      expect(asset).toEqual({
        name: "cli-linux-x64-musl-2.0.14.tgz",
        url: "https://registry.npmjs.org/@opencode/cli-linux-x64-musl/-/cli-linux-x64-musl-2.0.14.tgz",
        integrity: INTEGRITY,
      });
    });

    it(`${ISSUE} falls back to the next candidate when a preferred package is missing`, async () => {
      jest.mocked(requestUrl).mockImplementation((request) =>
        JSON.stringify(request).includes("baseline")
          ? response(404, {})
          : response(200, {
              dist: { tarball: "https://registry.npmjs.org/pkg.tgz", integrity: INTEGRITY },
            })
      );
      const asset = await resolveNpmAsset("2.0.14", [
        "opencode-windows-x64-baseline",
        "opencode-windows-x64",
      ]);
      expect(requestUrl).toHaveBeenCalledTimes(2);
      expect(asset.name).toBe("pkg.tgz");
    });

    it(`${ISSUE} resolves an OpenCode 1 release from its unscoped platform package`, async () => {
      jest.mocked(requestUrl).mockResolvedValue(
        response(200, {
          dist: {
            tarball:
              "https://registry.npmjs.org/opencode-darwin-arm64/-/opencode-darwin-arm64-1.18.31.tgz",
            integrity: INTEGRITY,
          },
        })
      );
      const asset = await resolveNpmAsset("1.18.31", ["opencode-darwin-arm64"]);
      expect(requestUrl).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://registry.npmjs.org/opencode-darwin-arm64/1.18.31" })
      );
      expect(asset.name).toBe("opencode-darwin-arm64-1.18.31.tgz");
    });

    it(`${ISSUE} stops trying fallback packages once the install is cancelled`, async () => {
      const controller = new AbortController();
      jest.mocked(requestUrl).mockImplementation(() => {
        controller.abort();
        return response(404, {});
      });
      await expect(
        resolveNpmAsset(
          "2.0.14",
          ["opencode-linux-x64-baseline-musl", "opencode-linux-x64-musl"],
          controller.signal
        )
      ).rejects.toThrow(ManagedInstallAbortError);
      expect(requestUrl).toHaveBeenCalledTimes(1);
    });

    it(`${ISSUE} fails clearly when no platform package exists`, async () => {
      jest.mocked(requestUrl).mockResolvedValue(response(404, {}));
      await expect(resolveNpmAsset("2.0.14", ["opencode-linux-arm64"])).rejects.toThrow(
        /No matching OpenCode npm package/
      );
    });

    it(`${ISSUE} rejects package metadata without a sha512 integrity`, async () => {
      jest
        .mocked(requestUrl)
        .mockResolvedValue(
          response(200, { dist: { tarball: "https://registry.npmjs.org/pkg.tgz" } })
        );
      await expect(resolveNpmAsset("2.0.14", ["opencode-darwin-arm64"])).rejects.toThrow(
        /sha512 integrity/
      );
    });

    it(`${ISSUE} reports registry failures instead of treating them as missing packages`, async () => {
      jest.mocked(requestUrl).mockResolvedValue(response(429, {}));
      await expect(resolveNpmAsset("2.0.14", ["opencode-darwin-arm64"])).rejects.toThrow(
        /status 429/
      );
    });
  });

  describe("verifyNpmIntegrity()", () => {
    it(`${ISSUE} accepts bytes matching npm's sha512 integrity`, async () => {
      const file = path.join(dir, "package.tgz");
      const bytes = new TextEncoder().encode("verified npm package");
      await fs.promises.writeFile(file, bytes);
      const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
      await expect(verifyNpmIntegrity(file, integrity)).resolves.toBeUndefined();
    });

    it(`${ISSUE} refuses a corrupted tarball before extraction`, async () => {
      const file = path.join(dir, "package.tgz");
      await fs.promises.writeFile(file, "corrupted");
      const integrity = `sha512-${createHash("sha512").update("original").digest("base64")}`;
      await expect(verifyNpmIntegrity(file, integrity)).rejects.toThrow(/integrity mismatch/);
    });

    it(`${ISSUE} honors cancellation while checking a download`, async () => {
      const file = path.join(dir, "package.tgz");
      await fs.promises.writeFile(file, "download");
      const controller = new AbortController();
      controller.abort();
      await expect(
        verifyNpmIntegrity(
          file,
          `sha512-${createHash("sha512").update("download").digest("base64")}`,
          controller.signal
        )
      ).rejects.toMatchObject({ name: "AbortError" });
    });
  });

  describe("extractNpmBinary()", () => {
    it(`${ISSUE} extracts only the expected binary without spawning an archive tool`, async () => {
      const archive = path.join(dir, "package.tgz");
      const dest = path.join(dir, "opencode");
      const bytes = new TextEncoder().encode("native binary bytes");
      await fs.promises.writeFile(
        archive,
        new Uint8Array(
          gzipSync(
            joinBytes(
              tarEntry("package/package.json", new TextEncoder().encode("{}")),
              tarEntry("package/bin/opencode", bytes),
              new Uint8Array(1024)
            )
          )
        )
      );
      await extractNpmBinary(archive, dest, "opencode");
      expect(await fs.promises.readFile(dest, "utf8")).toBe("native binary bytes");
      expect(fs.existsSync(path.join(dir, "package"))).toBe(false);
    });

    it(`${ISSUE} refuses a tarball without the platform binary`, async () => {
      const archive = path.join(dir, "package.tgz");
      await fs.promises.writeFile(
        archive,
        new Uint8Array(
          gzipSync(
            joinBytes(
              tarEntry("package/package.json", new TextEncoder().encode("{}")),
              new Uint8Array(1024)
            )
          )
        )
      );
      await expect(
        extractNpmBinary(archive, path.join(dir, "opencode"), "opencode")
      ).rejects.toThrow(/package\/bin\/opencode/);
    });

    it(`${ISSUE} honors cancellation before extracting the binary`, async () => {
      const archive = path.join(dir, "package.tgz");
      await fs.promises.writeFile(
        archive,
        new Uint8Array(
          gzipSync(
            joinBytes(
              tarEntry("package/bin/opencode", new TextEncoder().encode("binary")),
              new Uint8Array(1024)
            )
          )
        )
      );
      const controller = new AbortController();
      controller.abort();
      await expect(
        extractNpmBinary(archive, path.join(dir, "opencode"), "opencode", controller.signal)
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(fs.existsSync(path.join(dir, "opencode"))).toBe(false);
    });
  });
});
