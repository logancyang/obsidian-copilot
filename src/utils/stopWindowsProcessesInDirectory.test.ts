import { stopWindowsProcessesInDirectory } from "@/utils/stopWindowsProcessesInDirectory";
import type { ChildProcess } from "node:child_process";
import childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { once } from "node:events";

describe("stopWindowsProcessesInDirectory", () => {
  describe("stopWindowsProcessesInDirectory()", () => {
    afterEach(() => jest.restoreAllMocks());

    (process.platform === "win32" ? it : it.skip)(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 releases an actual Windows executable lock while keeping a sibling directory process running",
      async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-process-test-"));
        const directory = path.join(root, "O'Brien [managed]");
        const sibling = `${directory}-custom`;
        const children: ChildProcess[] = [];
        try {
          for (const folder of [directory, sibling]) {
            fs.mkdirSync(folder);
            const executable = path.join(folder, "node.exe");
            fs.copyFileSync(process.execPath, executable);
            const child = childProcess.spawn(executable, ["-e", "setInterval(() => {}, 1000)"], {
              stdio: "ignore",
            });
            children.push(child);
            await once(child, "spawn");
          }
          const [managed, custom] = children;
          const closed = once(managed, "close");
          await stopWindowsProcessesInDirectory(directory);
          await closed;
          fs.rmSync(directory, { recursive: true });
          expect(fs.existsSync(directory)).toBe(false);
          expect(custom.exitCode).toBeNull();
          expect(custom.signalCode).toBeNull();
        } finally {
          for (const child of children) {
            if (child.exitCode === null && child.signalCode === null) {
              const closed = once(child, "close");
              child.kill();
              await closed;
            }
          }
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
      30_000
    );

    it("leaves running executables alone on platforms that allow unlinking them", async () => {
      const exec = jest.spyOn(childProcess, "execFile");
      await stopWindowsProcessesInDirectory("/tmp/managed", "darwin");
      expect(exec).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 waits for Windows process termination before allowing directory removal", async () => {
      let complete!: () => void;
      let launched!: () => void;
      const started = new Promise<void>((resolve) => {
        launched = resolve;
      });
      const exec = jest.spyOn(childProcess, "execFile").mockImplementation((...args: unknown[]) => {
        complete = () => (args[args.length - 1] as (error: Error | null) => void)(null);
        launched();
        return {} as ChildProcess;
      });
      let stopped = false;
      const stopping = stopWindowsProcessesInDirectory("C:\\Users\\Test\\managed", "win32").then(
        () => {
          stopped = true;
        }
      );
      expect(await Promise.race([started.then(() => true), stopping.then(() => false)])).toBe(true);
      expect(stopped).toBe(false);
      expect(exec.mock.calls[0][0]).toBe("powershell.exe");
      complete();
      await stopping;
      expect(stopped).toBe(true);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 reports failed process termination instead of permitting deletion", async () => {
      jest.spyOn(childProcess, "execFile").mockImplementation((...args: unknown[]) => {
        (args[args.length - 1] as (error: Error) => void)(new Error("access denied"));
        return {} as ChildProcess;
      });
      await expect(stopWindowsProcessesInDirectory("C:\\managed", "win32")).rejects.toThrow(
        "Could not stop processes"
      );
    });
  });
});
