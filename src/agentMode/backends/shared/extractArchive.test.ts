import { EventEmitter } from "node:events";
import { extractArchive } from "@/agentMode/backends/shared/extractArchive";

const mockSpawn = jest.fn();
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: () => ({ spawn: mockSpawn }),
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/379";

describe("extractArchive", () => {
  describe("extractArchive()", () => {
    let child: EventEmitter & { stderr: EventEmitter };
    beforeEach(() => {
      child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
      mockSpawn.mockReset().mockReturnValue(child);
    });

    it("extracts into the destination without interpreting spaces as shell syntax", async () => {
      const result = extractArchive("/download dir/runtime.zip", "/stage dir");
      expect(mockSpawn).toHaveBeenCalledWith(
        "tar",
        ["-xf", "/download dir/runtime.zip", "-C", "/stage dir"],
        { stdio: ["ignore", "pipe", "pipe"], signal: undefined }
      );
      child.emit("close", 0);
      await expect(result).resolves.toBeUndefined();
    });

    it(`removes the bundle wrapper when requested: ${ISSUE}`, async () => {
      const result = extractArchive("runtime.tar.gz", "/stage", { stripComponents: 1 });
      expect(mockSpawn.mock.calls[0][1]).toContain("--strip-components=1");
      child.emit("close", 0);
      await result;
    });

    it("explains how to install tar when it is missing", async () => {
      const result = extractArchive("runtime.zip", "/stage");
      child.emit("error", Object.assign(new Error("spawn tar ENOENT"), { code: "ENOENT" }));
      child.emit("close", -2);
      await expect(result).rejects.toThrow("`tar` was not found on PATH");
    });

    it("reports other launch failures", async () => {
      const result = extractArchive("runtime.zip", "/stage");
      child.emit("error", new Error("permission denied"));
      child.emit("close", -1);
      await expect(result).rejects.toThrow("Failed to launch tar: permission denied");
    });

    it("includes tar's diagnostic when extraction fails", async () => {
      const result = extractArchive("runtime.zip", "/stage");
      child.stderr.emit("data", Buffer.from("Invalid archive"));
      child.emit("close", 1);
      await expect(result).rejects.toThrow("tar exited with code 1: Invalid archive");
    });

    it(`waits for the cancelled process to close before allowing staging cleanup: ${ISSUE}`, async () => {
      const controller = new AbortController();
      const result = extractArchive("runtime.zip", "/stage", { signal: controller.signal });
      let settled = false;
      const rejection = result.catch((error: Error) => {
        settled = true;
        return error;
      });
      expect(mockSpawn.mock.calls[0][2].signal).toBe(controller.signal);
      controller.abort();
      child.emit("error", Object.assign(new Error("Aborted"), { name: "AbortError" }));
      await Promise.resolve();
      expect(settled).toBe(false);
      child.emit("close", null);
      expect(await rejection).toMatchObject({ name: "AbortError" });
    });
  });
});
