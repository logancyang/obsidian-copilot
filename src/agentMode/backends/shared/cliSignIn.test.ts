import { signInWithCli, signOutWithCli } from "./cliSignIn";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const mockSpawn = jest.fn();
const mockExec = jest.fn();
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: (id: string) =>
    id === "child_process"
      ? { spawn: mockSpawn, execFile: mockExec }
      : jest.requireActual(`node:${id}`),
}));
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/379";
describe("cliSignIn", () => {
  describe("signOutWithCli()", () => {
    afterEach(() => jest.restoreAllMocks());
    it(`preserves the post-logout status and account label: ${ISSUE}`, async () => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      mockSpawn.mockReset().mockReturnValue(child);
      const status = { loggedIn: true, label: "zero@example.com" };
      const read = jest.fn().mockResolvedValue(status);
      const result = signOutWithCli("/cli", ["logout"], { PROFILE: "/profile" }, read);
      child.emit("close", 1);
      await expect(result).resolves.toEqual(status);
      expect(read).toHaveBeenCalledTimes(1);
    });
    it(`rejects failed startup instead of claiming logout succeeded: ${ISSUE}`, async () => {
      mockSpawn.mockReset().mockImplementation(() => {
        throw new Error("missing");
      });
      const read = jest.fn();
      await expect(signOutWithCli("/cli", ["logout"], {}, read)).rejects.toThrow(
        "Sign-out did not complete"
      );
      expect(read).not.toHaveBeenCalled();
    });
    it(`rejects cancellation while the post-logout probe is pending: ${ISSUE}`, async () => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      mockSpawn.mockReset().mockReturnValue(child);
      let finish!: (status: { loggedIn: boolean }) => void;
      const controller = new AbortController();
      const result = signOutWithCli(
        "/cli",
        ["logout"],
        {},
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        { signal: controller.signal }
      );
      child.emit("close", 0);
      controller.abort();
      finish({ loggedIn: false });
      await expect(result).rejects.toThrow("Sign-out did not complete");
    });
  });
  describe("signInWithCli()", () => {
    it(`supports account protocol input and settles broken input without leaking a probe: ${ISSUE}`, async () => {
      const stdin = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      mockSpawn.mockReset().mockReturnValue(child);
      const readStatus = jest.fn();
      const { done } = signInWithCli("/cli", ["app-server"], {}, readStatus, {
        onStdin: (input) => input.write("initialize\n"),
      });
      expect(stdin.read().toString()).toBe("initialize\n");
      expect(mockSpawn).toHaveBeenCalledWith(
        "/cli",
        ["app-server"],
        expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] })
      );
      stdin.emit("error", new Error("EPIPE"));
      await expect(done).resolves.toEqual({ loggedIn: false });
      expect(readStatus).not.toHaveBeenCalled();
    });

    let child: EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: jest.Mock;
      pid: number;
    };
    beforeEach(() => {
      child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: jest.fn(),
        pid: 12345,
      });
      mockSpawn.mockReset().mockReturnValue(child);
      jest.spyOn(process, "kill").mockReturnValue(true);
    });
    afterEach(() => jest.restoreAllMocks());
    it(`offers the printed browser fallback and reads authoritative status after exit: ${ISSUE}`, async () => {
      const read = jest.fn().mockResolvedValue({ loggedIn: false });
      const onUrl = jest.fn();
      const login = signInWithCli("/adapter", ["cli", "login"], { CODEX_HOME: "/profile" }, read, {
        onUrl,
      });
      child.stderr.write("Open https://auth.openai.com/sign-");
      child.stderr.write("in\n");
      expect(onUrl).toHaveBeenCalledWith("https://auth.openai.com/sign-in");
      child.emit("close", 0);
      await expect(login.done).resolves.toEqual({ loggedIn: false });
      expect(read).toHaveBeenCalledTimes(1);
      expect(mockSpawn).toHaveBeenCalledWith(
        "/adapter",
        ["cli", "login"],
        expect.objectContaining({ env: { CODEX_HOME: "/profile" }, windowsHide: true })
      );
    });
    it(`rejects diagnostic URLs and offers the later authorization URL: ${ISSUE}`, async () => {
      const onUrl = jest.fn();
      const login = signInWithCli("/adapter", [], {}, async () => ({ loggedIn: true }), {
        onUrl,
        acceptUrl: (url) => new URL(url).hostname === "auth.openai.com",
      });
      child.stdout.write("Help: https://example.com/help\n");
      expect(onUrl).not.toHaveBeenCalled();
      child.stderr.write("Open https://auth.openai.com/authorize\n");
      expect(onUrl).toHaveBeenCalledTimes(1);
      expect(onUrl).toHaveBeenCalledWith("https://auth.openai.com/authorize");
      child.emit("close", 0);
      await login.done;
    });
    it(`stops descendants after proxy exit and waits for their pipes to close: ${ISSUE}`, async () => {
      const read = jest.fn();
      const login = signInWithCli("/adapter", [], {}, read);
      const done = jest.fn();
      void login.done.then(done);
      child.emit("exit", 0);
      login.cancel();
      await Promise.resolve();
      expect(process.kill).toHaveBeenCalledWith(-12345, "SIGTERM");
      expect(done).not.toHaveBeenCalled();
      child.emit("close", 0);
      await expect(login.done).resolves.toEqual({ loggedIn: false });
      expect(read).not.toHaveBeenCalled();
    });
    it.each(["cancel", "abort"])(
      `terminates login on %s and ignores stale success: ${ISSUE}`,
      async (action) => {
        const controller = new AbortController();
        const read = jest.fn().mockResolvedValue({ loggedIn: true });
        const login = signInWithCli("/adapter", [], {}, read, { signal: controller.signal });
        if (action === "cancel") login.cancel();
        else controller.abort();
        child.emit("close", 0);
        await expect(login.done).resolves.toEqual({ loggedIn: false });
        expect(process.kill).toHaveBeenCalledWith(-12345, "SIGTERM");
        expect(read).not.toHaveBeenCalled();
      }
    );
    it(`does not signal a reaped process while its status probe finishes: ${ISSUE}`, async () => {
      let resolveStatus!: (status: { loggedIn: boolean }) => void;
      const login = signInWithCli(
        "/adapter",
        [],
        {},
        () =>
          new Promise((resolve) => {
            resolveStatus = resolve;
          })
      );
      child.emit("exit", 0);
      child.emit("close", 0);
      login.cancel();
      await expect(login.done).resolves.toEqual({ loggedIn: false });
      resolveStatus({ loggedIn: true });
      expect(process.kill).not.toHaveBeenCalled();
    });
    it(`waits for descendant pipes without targeting a reaped Windows PID: ${ISSUE}`, async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
      mockExec.mockReset();
      try {
        const login = signInWithCli("adapter.exe", [], {}, jest.fn());
        const done = jest.fn();
        void login.done.then(done);
        child.emit("exit", 0);
        login.cancel();
        await Promise.resolve();
        expect(done).not.toHaveBeenCalled();
        expect(mockExec).not.toHaveBeenCalled();
        child.emit("close", 0);
        await expect(login.done).resolves.toEqual({ loggedIn: false });
      } finally {
        Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
      }
    });
    it(`waits for scoped Windows tree termination before Retry: ${ISSUE}`, async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
      let complete!: (error: Error | null) => void;
      mockExec.mockImplementation((_command, _args, _options, callback) => {
        complete = callback;
      });
      try {
        const login = signInWithCli("adapter.exe", [], {}, jest.fn());
        let completed = false;
        void login.done.then(() => {
          completed = true;
        });
        login.cancel();
        child.emit("exit", 1);
        child.emit("close", 1);
        await Promise.resolve();
        expect(completed).toBe(false);
        expect(mockExec).toHaveBeenCalledWith(
          "taskkill",
          ["/PID", "12345", "/T", "/F"],
          { windowsHide: true },
          expect.any(Function)
        );
        complete(null);
        await expect(login.done).resolves.toEqual({ loggedIn: false });
        login.cancel();
        expect(mockExec).toHaveBeenCalledTimes(1);
      } finally {
        Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
      }
    });
    (process.platform === "win32" ? it.skip : it)(
      `Cancel and dialog abort stop a real proxy's child listener before Retry: ${ISSUE}`,
      async () => {
        jest.mocked(process.kill).mockRestore();
        const node = jest.requireActual<typeof import("node:child_process")>("node:child_process");
        const net = jest.requireActual<typeof import("node:net")>("node:net");
        mockSpawn.mockImplementation(node.spawn);
        const runtimeScript =
          'require("net").createServer().listen(0,"127.0.0.1",function(){console.log("READY " + this.address().port)});';
        const proxyScript = `require("child_process").spawn(process.execPath,["-e",${JSON.stringify(runtimeScript)}],{stdio:["ignore","inherit","inherit"]});setInterval(()=>{},1000);`;
        for (const action of ["cancel", "abort", "proxy-exit"]) {
          let ready!: (port: number) => void;
          const portReady = new Promise<number>((resolve) => {
            ready = resolve;
          });
          const abort = new AbortController();
          const script =
            action === "proxy-exit"
              ? proxyScript.replace("setInterval(()=>{},1000);", "process.exit(0);")
              : proxyScript;
          const login = signInWithCli(process.execPath, ["-e", script], {}, jest.fn(), {
            signal: abort.signal,
            onLine: (line) => {
              if (line.startsWith("READY ")) ready(Number(line.slice(6)));
            },
          });
          const proxy = mockSpawn.mock.results.at(-1)!
            .value as import("node:child_process").ChildProcess;
          try {
            const port = await portReady;
            if (action === "proxy-exit" && proxy.exitCode === null) {
              await new Promise<void>((resolve) => proxy.once("exit", () => resolve()));
            }
            if (action === "cancel" || action === "proxy-exit") login.cancel();
            else abort.abort();
            await expect(login.done).resolves.toEqual({ loggedIn: false });
            await new Promise<void>((resolve, reject) => {
              const socket = net.connect(port, "127.0.0.1");
              socket.once("error", () => resolve());
              socket.once("connect", () => {
                socket.destroy();
                reject(new Error("Login listener survived cancellation"));
              });
            });
            expect(proxy.exitCode !== null || proxy.signalCode !== null).toBe(true);
          } finally {
            if (proxy.pid) {
              try {
                process.kill(-proxy.pid, "SIGKILL");
              } catch {
                /* Already stopped. */
              }
            }
          }
        }
      },
      10_000
    );
    it(`settles a failed spawn so Retry can launch again: ${ISSUE}`, async () => {
      const login = signInWithCli("missing", [], {}, jest.fn());
      child.emit("error", new Error("ENOENT"));
      await expect(login.done).resolves.toEqual({ loggedIn: false });
      const retry = signInWithCli("found", [], {}, async () => ({ loggedIn: true }));
      child.emit("close", 0);
      await expect(retry.done).resolves.toEqual({ loggedIn: true });
    });
  });
});
