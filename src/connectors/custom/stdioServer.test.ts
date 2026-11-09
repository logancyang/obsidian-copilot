/**
 * @jest-environment node
 */
import { cmdShellArgs, START_TIMEOUT_MS, StdioServer } from "@/connectors/custom/stdioServer";
import {
  fakeStdioServer,
  fakeStdioServerBehindLauncher,
} from "@/connectors/custom/testing/fakeStdioServer";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/862";

describe("stdioServer", () => {
  describe("StdioServer", () => {
    const started: StdioServer[] = [];
    function server(
      options = fakeStdioServer(),
      onCrash: (reason: string) => void = jest.fn()
    ): StdioServer {
      const created = new StdioServer(options, onCrash);
      started.push(created);
      return created;
    }
    afterEach(async () => {
      await Promise.all(started.splice(0).map((created) => created.stop()));
    });

    describe("start()", () => {
      it("starts the command and completes the MCP handshake, skipping output lines that aren't messages", async () => {
        const echo = server();

        await echo.start();

        await expect(echo.request("tools/list", {})).resolves.toEqual({
          tools: [
            expect.objectContaining({ name: "echo", annotations: { readOnlyHint: true } }),
            expect.objectContaining({ name: "crash" }),
          ],
        });
      });

      it("fails with the last line the command printed to stderr when it exits before answering", async () => {
        await expect(server(fakeStdioServer({})).start()).rejects.toThrow("FAKE_KEY is not set");
      });

      it(`passes arguments with spaces, quotes and cmd metacharacters intact through a launcher script, a .cmd shim on Windows: ${ISSUE}`, async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-stdio-"));
        const args = ["a b", 'say "hi"', "x&y|z", '{"q":"a&b"}', "50%", "C:\\dir\\"];
        try {
          const echo = server(fakeStdioServerBehindLauncher(dir, args));
          await echo.start();

          await expect(
            echo.request("tools/call", { name: "args", arguments: {} })
          ).resolves.toEqual({
            content: [{ type: "text", text: JSON.stringify(args) }],
          });
          await echo.stop();
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });

      it(`waits START_TIMEOUT_MS, past the SDK's 60-second default, for a server that is still downloading before it answers the handshake: ${ISSUE}`, async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-stdio-"));
        const marker = path.join(dir, "initialize-received");
        try {
          const handshakeReceived = new Promise<void>((resolve) => {
            const watcher = fs.watch(dir, () => {
              watcher.close();
              resolve();
            });
          });
          jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
          const slow = server(fakeStdioServer({ FAKE_KEY: "k", FAKE_SLOW_START_MARKER: marker }));
          let settled = false;

          const starting = slow
            .start()
            .then(
              () => "started",
              (error: Error) => error.message
            )
            .finally(() => (settled = true));
          await handshakeReceived;
          await jest.advanceTimersByTimeAsync(START_TIMEOUT_MS - 1);
          expect(settled).toBe(false);
          await jest.advanceTimersByTimeAsync(1);

          await expect(starting).resolves.toBe("MCP error -32001: Request timed out");
        } finally {
          jest.useRealTimers();
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });

      it("fails with a readable reason when the command doesn't exist", async () => {
        const missing = { command: "copilot-no-such-command", args: [], env: process.env };

        await expect(server(missing).start()).rejects.toThrow(
          "Couldn't find copilot-no-such-command."
        );
      });
    });

    describe("request()", () => {
      it("returns the server's result for a tool call", async () => {
        const echo = server();
        await echo.start();

        await expect(
          echo.request("tools/call", { name: "echo", arguments: { text: "hi" } })
        ).resolves.toEqual({ content: [{ type: "text", text: "echo: hi" }] });
      });

      it("rejects with the server's JSON-RPC error message", async () => {
        const echo = server();
        await echo.start();

        await expect(echo.request("resources/list", {})).rejects.toThrow(
          "Method not found: resources/list"
        );
      });

      it(`answers the server's ping, so a tool call that waits for the reply completes: ${ISSUE}`, async () => {
        const echo = server();
        await echo.start();

        await expect(echo.request("tools/call", { name: "ping", arguments: {} })).resolves.toEqual({
          content: [{ type: "text", text: "pinged" }],
        });
      });

      it(`rejects the call in flight and reports the crash with its reason when the process dies: ${ISSUE}`, async () => {
        let reportCrash: (reason: string) => void = () => {};
        const crashed = new Promise<string>((resolve) => (reportCrash = resolve));
        const echo = server(fakeStdioServer(), reportCrash);
        await echo.start();

        await expect(echo.request("tools/call", { name: "crash", arguments: {} })).rejects.toThrow(
          "crashing on request"
        );
        await expect(crashed).resolves.toBe("crashing on request");
        await expect(echo.request("tools/list", {})).rejects.toThrow("crashing on request");
      });
    });

    describe("stop()", () => {
      it(`ends the whole process tree, so it resolves only once a child process sharing the server's output has exited too: ${ISSUE}`, async () => {
        const onCrash = jest.fn();
        const echo = server(fakeStdioServer({ FAKE_KEY: "k", FAKE_GRANDCHILD: "1" }), onCrash);
        await echo.start();

        await echo.stop();

        expect(onCrash).not.toHaveBeenCalled();
        await expect(echo.request("tools/list", {})).rejects.toThrow();
      });
    });
  });

  describe("cmdShellArgs()", () => {
    it(`quotes the .cmd path once and each argument twice, escaping quotes and cmd metacharacters, so the shim forwards them intact: ${ISSUE}`, () => {
      expect(
        cmdShellArgs("C:\\Program Files (x86)\\nodejs\\npx.cmd", [
          "-y",
          "a b",
          'say "hi"',
          "x&y",
          "C:\\dir\\",
        ])
      ).toEqual([
        "/d",
        "/s",
        "/c",
        String.raw`"^"C:\Program^ Files^ ^(x86^)\nodejs\npx.cmd^" ^^^"-y^^^" ^^^"a^^^ b^^^" ^^^"say^^^ \^^^"hi\^^^"^^^" ^^^"x^^^&y^^^" ^^^"C:\dir\\^^^""`,
      ]);
    });
  });
});
