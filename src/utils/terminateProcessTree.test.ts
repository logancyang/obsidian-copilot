import { terminateProcessTree } from "./terminateProcessTree";
const mockExecFile = jest.fn();
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: () => ({ execFile: mockExecFile }),
}));
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/620";
const child = { pid: 23456 } as import("node:child_process").ChildProcess;
async function onPlatform<T>(platform: NodeJS.Platform, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}
describe("terminateProcessTree", () => {
  describe("terminateProcessTree()", () => {
    afterEach(() => jest.restoreAllMocks());
    it(`signals only the owned POSIX process group: ${ISSUE}`, async () => {
      const kill = jest.spyOn(process, "kill").mockReturnValue(true);
      await onPlatform("darwin", () => terminateProcessTree(child, "SIGKILL"));
      expect(kill).toHaveBeenCalledWith(-23456, "SIGKILL");
    });
    it(`awaits termination of only the owned Windows PID tree: ${ISSUE}`, async () => {
      let finish!: (error: Error | null) => void;
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _options: object,
          callback: (error: Error | null) => void
        ) => {
          finish = callback;
        }
      );
      let stopped = false;
      const stopping = onPlatform("win32", () => terminateProcessTree(child)).then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);
      expect(mockExecFile).toHaveBeenCalledWith(
        "taskkill.exe",
        ["/PID", "23456", "/T", "/F"],
        { windowsHide: true, timeout: 10000 },
        expect.any(Function)
      );
      finish(null);
      await stopping;
      expect(stopped).toBe(true);
    });
    it(`reports a Windows termination failure instead of authorizing deletion: ${ISSUE}`, async () => {
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _options: object,
          callback: (error: Error | null) => void
        ) => {
          callback(new Error("Access denied"));
        }
      );
      await expect(onPlatform("win32", () => terminateProcessTree(child))).rejects.toThrow(
        "Access denied"
      );
    });
    (process.platform === "win32" ? it : it.skip)(
      `releases a real Windows executable lock while leaving an unrelated process alive: ${ISSUE}`,
      async () => {
        const node = jest.requireActual<typeof import("node:child_process")>("node:child_process");
        const fs = jest.requireActual<typeof import("node:fs")>("node:fs");
        const os = jest.requireActual<typeof import("node:os")>("node:os");
        const path = jest.requireActual<typeof import("node:path")>("node:path");
        mockExecFile.mockImplementation(node.execFile);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-owned-tree-"));
        const exe = path.join(dir, "runtime.exe");
        fs.copyFileSync(process.execPath, exe);
        const script = `require("child_process").spawn(${JSON.stringify(exe)}, ["-e", 'console.log("READY");setInterval(()=>{},1000)'], {stdio:["ignore","inherit","inherit"]});setInterval(()=>{},1000);`;
        const parent = node.spawn(process.execPath, ["-e", script], { windowsHide: true });
        const sibling = node.spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
          windowsHide: true,
        });
        const closed = new Promise<void>((resolve) => parent.once("close", () => resolve()));
        try {
          await new Promise<void>((resolve, reject) => {
            parent.once("error", reject);
            parent.stdout.on("data", (chunk: Buffer) => {
              if (chunk.toString().includes("READY")) resolve();
            });
          });
          expect(() => fs.unlinkSync(exe)).toThrow();
          await terminateProcessTree(parent);
          await closed;
          fs.rmSync(dir, { recursive: true });
          expect(fs.existsSync(dir)).toBe(false);
          expect(sibling.exitCode).toBeNull();
          expect(sibling.signalCode).toBeNull();
        } finally {
          if (parent.exitCode === null && parent.signalCode === null)
            await terminateProcessTree(parent);
          sibling.kill();
          await new Promise<void>((resolve) => sibling.once("close", () => resolve()));
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
      15000
    );
    it(`does not signal an identifier when spawning failed: ${ISSUE}`, async () => {
      const kill = jest.spyOn(process, "kill").mockReturnValue(true);
      await terminateProcessTree({} as import("node:child_process").ChildProcess);
      expect(kill).not.toHaveBeenCalled();
    });
  });
});
