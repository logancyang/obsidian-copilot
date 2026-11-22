import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "child_process";
import { FileSystemAdapter, requestUrl, type RequestUrlParam } from "obsidian";
import type CopilotPlugin from "@/main";
import { resetSettings, setSettings } from "@/settings/model";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { opencodeApprovedRules } from "./opencodeApprovedRules";

jest.mock("obsidian", () => ({ ...jest.requireActual("obsidian"), requestUrl: jest.fn() }));
jest.mock("child_process", () => ({ spawn: jest.fn() }));
jest.mock("@/utils/loginShellPath", () => ({
  agentShellPath: jest.fn(async () => "/login/bin:/usr/bin"),
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/867";
const SERVER_URL = "http://127.0.0.1:4100";
const PROJECT = { id: "proj_vault", directory: "/Users/me/vault" };

interface FakeServer extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  kill: jest.Mock<boolean, [NodeJS.Signals?]>;
  exited: boolean;
  stopRequested: Promise<void>;
}

function fakeServer(options: { ready?: boolean; exitsOn?: NodeJS.Signals } = {}): FakeServer {
  const server = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    exited: false,
  }) as FakeServer;
  let stopRequested!: () => void;
  server.stopRequested = new Promise<void>((resolve) => (stopRequested = resolve));
  server.kill = jest.fn((signal: NodeJS.Signals = "SIGTERM") => {
    stopRequested();
    if (server.exited || (options.exitsOn && options.exitsOn !== signal)) return false;
    server.exited = true;
    server.emit("exit", null, signal);
    return true;
  });
  if (options.ready === false) {
    server.exited = true;
    process.nextTick(() => server.emit("exit", 1, null));
  } else {
    server.stdout.write(`${JSON.stringify({ url: SERVER_URL })}\n`);
  }
  return server;
}

interface FakeResponse {
  status: number;
  json?: unknown;
  text?: string;
}

function answer(routes: Record<string, FakeResponse | (() => Promise<FakeResponse>)>): void {
  jest.mocked(requestUrl).mockImplementation(((request: RequestUrlParam) => {
    const route = routes[`${request.method} ${request.url.slice(SERVER_URL.length)}`];
    if (!route) throw new Error(`unexpected request ${request.method} ${request.url}`);
    return typeof route === "function" ? route() : Promise.resolve({ text: "", ...route });
  }) as unknown as typeof requestUrl);
}

const LIST_ROUTES = {
  "GET /api/location": { status: 200, json: { directory: PROJECT.directory, project: PROJECT } },
  [`GET /api/permission/saved?projectID=${PROJECT.id}`]: {
    status: 200,
    json: {
      data: [
        { id: "psv_1", projectID: PROJECT.id, action: "shell", resource: "echo *" },
        { id: "psv_2", projectID: PROJECT.id, action: "external_directory", resource: "/tmp/*" },
      ],
    },
  },
};

describe("opencodeApprovedRules", () => {
  let binDir: string;
  let binaryPath: string;
  let plugin: CopilotPlugin;

  function installOpencode(version: string, envOverrides?: Record<string, string>): void {
    setSettings({
      agentMode: {
        backends: { opencode: { binaryPath, binaryVersion: version, envOverrides } },
      },
    } as never);
  }

  beforeEach(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-rules-"));
    binaryPath = path.join(binDir, "opencode");
    fs.writeFileSync(binaryPath, "");
    resetSettings();
    __resetVaultBaseCache();
    installOpencode("2.0.32");
    const adapter = Object.create(FileSystemAdapter.prototype) as FileSystemAdapter;
    adapter.getBasePath = () => PROJECT.directory;
    plugin = { app: { vault: { adapter } } } as never;
  });

  afterEach(() => {
    jest.mocked(spawn).mockReset();
    jest.mocked(requestUrl).mockReset();
    jest.useRealTimers();
    resetSettings();
    __resetVaultBaseCache();
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  describe("list()", () => {
    it("lists the rules OpenCode saved for the vault folder's project as 'action: resource', each applying to chats in the project's folder", async () => {
      const server = fakeServer();
      jest.mocked(spawn).mockReturnValue(server as never);
      answer(LIST_ROUTES);

      const rules = await opencodeApprovedRules.list(plugin);

      expect(rules).toEqual([
        {
          id: "psv_1",
          allows: "shell: echo *",
          appliesTo: { kind: "folder", path: PROJECT.directory },
        },
        {
          id: "psv_2",
          allows: "external_directory: /tmp/*",
          appliesTo: { kind: "folder", path: PROJECT.directory },
        },
      ]);
    });

    it("asks a short-lived `opencode serve --stdio` started in the vault folder with the agent's login-shell PATH and environment variables, using the password it was started with, and stops it afterwards", async () => {
      installOpencode("2.0.32", { XDG_DATA_HOME: "/scratch/data" });
      const server = fakeServer();
      jest.mocked(spawn).mockReturnValue(server as never);
      answer(LIST_ROUTES);

      await opencodeApprovedRules.list(plugin);

      const [command, args, spawnOptions] = jest.mocked(spawn).mock.calls[0] as unknown as [
        string,
        string[],
        { cwd: string; env: Record<string, string> },
      ];
      expect([command, args, spawnOptions.cwd]).toEqual([
        binaryPath,
        ["serve", "--stdio", "--port", "0"],
        PROJECT.directory,
      ]);
      expect(spawnOptions.env.PATH).toBe("/login/bin:/usr/bin");
      expect(spawnOptions.env.XDG_DATA_HOME).toBe("/scratch/data");
      const password = spawnOptions.env.OPENCODE_PASSWORD;
      expect(password).toMatch(/.{32,}/);
      for (const [request] of jest.mocked(requestUrl).mock.calls) {
        expect((request as RequestUrlParam).headers).toEqual({
          Authorization: `Basic ${btoa(`opencode:${password}`)}`,
        });
      }
      expect(server.exited).toBe(true);
    });

    it("shows that the vault folder's project has no rules when OpenCode saved none for it", async () => {
      jest.mocked(spawn).mockReturnValue(fakeServer() as never);
      answer({
        ...LIST_ROUTES,
        [`GET /api/permission/saved?projectID=${PROJECT.id}`]: { status: 200, json: { data: [] } },
      });

      await expect(opencodeApprovedRules.list(plugin)).resolves.toEqual([]);
    });

    it(`${ISSUE} rejects with a not-installed message, without starting anything, when OpenCode isn't installed`, async () => {
      fs.rmSync(binaryPath);

      await expect(opencodeApprovedRules.list(plugin)).rejects.toThrow("OpenCode isn't installed.");
      expect(spawn).not.toHaveBeenCalled();
    });

    it(`${ISSUE} rejects asking for a newer OpenCode, without starting it, when the installed OpenCode predates the saved-permission API`, async () => {
      installOpencode("1.19.5");

      await expect(opencodeApprovedRules.list(plugin)).rejects.toThrow(
        "OpenCode v1.19.5 is not supported. Copilot requires OpenCode v2.0.21 or newer."
      );
      expect(spawn).not.toHaveBeenCalled();
    });

    it(`${ISSUE} rejects when the OpenCode binary exits before its server is ready, as a binary without \`serve --stdio\` does`, async () => {
      jest.mocked(spawn).mockReturnValue(fakeServer({ ready: false }) as never);

      await expect(opencodeApprovedRules.list(plugin)).rejects.toThrow(
        "OpenCode's server stopped before it was ready (exit code 1)."
      );
      expect(requestUrl).not.toHaveBeenCalled();
    });

    it(`${ISSUE} rejects with OpenCode's answer and stops the server when the API answers with an error`, async () => {
      const server = fakeServer();
      jest.mocked(spawn).mockReturnValue(server as never);
      answer({
        "GET /api/location": { status: 404, text: "" },
      });

      await expect(opencodeApprovedRules.list(plugin)).rejects.toThrow(
        "OpenCode answered 404 to GET /api/location."
      );
      expect(server.exited).toBe(true);
    });

    it(`${ISSUE} rejects and stops the server when OpenCode doesn't answer within 30 seconds`, async () => {
      jest.useFakeTimers();
      const server = fakeServer();
      jest.mocked(spawn).mockReturnValue(server as never);
      let requested!: () => void;
      const requestStarted = new Promise<void>((resolve) => (requested = resolve));
      answer({
        "GET /api/location": () => {
          requested();
          return new Promise<FakeResponse>(() => {});
        },
      });

      const listing = opencodeApprovedRules.list(plugin);
      const settled = expect(listing).rejects.toThrow("OpenCode didn't answer within 30 seconds.");
      await requestStarted;
      jest.advanceTimersByTime(30_000);

      await settled;
      expect(server.exited).toBe(true);
    });

    it(`${ISSUE} force-stops a server that ignores the stop request`, async () => {
      jest.useFakeTimers();
      const server = fakeServer({ exitsOn: "SIGKILL" });
      jest.mocked(spawn).mockReturnValue(server as never);
      answer({
        ...LIST_ROUTES,
        [`GET /api/permission/saved?projectID=${PROJECT.id}`]: { status: 200, json: { data: [] } },
      });

      const listing = opencodeApprovedRules.list(plugin);
      await server.stopRequested;
      jest.advanceTimersByTime(3_000);

      await expect(listing).resolves.toEqual([]);
      expect(server.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    });
  });

  describe("remove()", () => {
    const rule = {
      id: "psv_1",
      allows: "shell: echo *",
      appliesTo: { kind: "folder", path: PROJECT.directory },
    } as const;

    it("deletes the rule by its saved-permission id through OpenCode's API and stops the server", async () => {
      const server = fakeServer();
      jest.mocked(spawn).mockReturnValue(server as never);
      answer({ "DELETE /api/permission/saved/psv_1": { status: 204 } });

      await opencodeApprovedRules.remove(plugin, rule);

      expect(jest.mocked(requestUrl).mock.calls.map(([request]) => request)).toEqual([
        expect.objectContaining({
          method: "DELETE",
          url: `${SERVER_URL}/api/permission/saved/psv_1`,
        }),
      ]);
      expect(server.exited).toBe(true);
    });

    it(`${ISSUE} rejects with OpenCode's answer and stops the server when the removal fails`, async () => {
      const server = fakeServer();
      jest.mocked(spawn).mockReturnValue(server as never);
      answer({
        "DELETE /api/permission/saved/psv_1": {
          status: 500,
          text: '{"_tag":"DatabaseError","message":"database is locked"}',
        },
      });

      await expect(opencodeApprovedRules.remove(plugin, rule)).rejects.toThrow(
        'OpenCode answered 500 to DELETE /api/permission/saved/psv_1. {"_tag":"DatabaseError","message":"database is locked"}'
      );
      expect(server.exited).toBe(true);
    });
  });
});
