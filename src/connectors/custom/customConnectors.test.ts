/**
 * @jest-environment node
 */
import { MAX_PROVIDED_TOOL_NAME_LENGTH } from "@/agentMode/session/copilotMcpServer";
import { CustomConnectors } from "@/connectors/custom/customConnectors";
import { FakeProcess } from "@/connectors/custom/testing/fakeCustomProcess";
import { fakeKeychain } from "@/connectors/custom/testing/fakeKeychain";
import { FakeMcpService } from "@/connectors/testing/fakeMcpService";
import { logWarn } from "@/logger";
import { getSettings, setSettings } from "@/settings/model";
import { augmentPathForDetection } from "@/utils/binaryPath";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));
jest.mock("@/utils/loginShellPath", () => ({
  loginShellPathDirs: async () => ["/login-shell/bin"],
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/862";
const REMOTE_URL = "https://mcp.acme.test/mcp";
const KEYCHAIN_PREFIX = "copilot-vtestvault-custom-connector-";

const LOCAL_JSON = JSON.stringify({
  mcpServers: { Echo: { command: "echo-server", args: ["--stdio"], env: { FAKE_KEY: "k-1" } } },
});
const REMOTE_JSON = JSON.stringify({
  mcpServers: { Acme: { url: REMOTE_URL, headers: { Authorization: "Bearer acme-1" } } },
});

function setUp(options: { enabled?: boolean } = {}) {
  jest.mocked(logWarn).mockClear();
  setSettings({ customConnectors: [] });
  const { keychain, secrets } = fakeKeychain();
  const device = new Map<string, unknown>();
  const processes: FakeProcess[] = [];
  const remote = new FakeMcpService(REMOTE_URL);
  remote.validTokens.add("acme-1");
  remote.tools = [{ name: "search", annotations: { readOnlyHint: true } }];
  const custom = new CustomConnectors({
    keychain,
    deviceStorage: {
      load: (key) => device.get(key) ?? null,
      save: (key, value) => void device.set(key, value),
    },
    catalogIds: ["notion"],
    isEnabled: () => options.enabled ?? true,
    maxToolNameLength: MAX_PROVIDED_TOOL_NAME_LENGTH,
    cwd: "/vault",
    fetch: remote.fetch,
    startProcess: (processOptions, crash) => {
      const process = new FakeProcess(processOptions, crash);
      processes.push(process);
      return process;
    },
  });
  const statusOf = (id: string) =>
    custom.getSnapshot().connectors.find(({ config }) => config.id === id)?.status;
  const add = async (text: string) => {
    const parsed = custom.parse(text);
    if (!parsed.ok) throw new Error(parsed.error);
    custom.add(parsed.connectors);
    await custom.refresh();
  };
  return { custom, secrets, device, processes, remote, statusOf, add };
}

function connectedWith(...names: string[]) {
  return {
    kind: "connected",
    tools: names.map((name): unknown => expect.objectContaining({ name })),
  };
}

function loggedText(): string {
  return jest
    .mocked(logWarn)
    .mock.calls.flat()
    .map((arg) => (arg instanceof Error ? `${arg.stack}` : String(arg)))
    .join("\n");
}

function textOf(result: { content: readonly unknown[] } | null | undefined): string {
  return (result?.content ?? []).map((item) => (item as { text?: string }).text ?? "").join("");
}

describe("customConnectors", () => {
  describe("CustomConnectors", () => {
    afterEach(() => jest.useRealTimers());

    describe("parse()", () => {
      it("names a connector clear of catalog services and connectors already added", async () => {
        const fake = setUp();
        await fake.add(LOCAL_JSON);

        const parsed = fake.custom.parse(
          JSON.stringify({ mcpServers: { Notion: { command: "a" }, Echo: { command: "b" } } })
        );

        expect(parsed.ok && parsed.connectors.map(({ config }) => config.id)).toEqual([
          "notion2",
          "echo2",
        ]);
      });
    });

    describe("add()", () => {
      it(`syncs the config with env and header names only and keeps every value in this device's keychain: ${ISSUE}`, async () => {
        const fake = setUp();

        await fake.add(LOCAL_JSON);
        await fake.add(REMOTE_JSON);

        expect(getSettings().customConnectors).toEqual([
          {
            id: "echo",
            name: "Echo",
            command: "echo-server",
            args: ["--stdio"],
            envNames: ["FAKE_KEY"],
          },
          { id: "acme", name: "Acme", url: REMOTE_URL, headerNames: ["Authorization"] },
        ]);
        expect(JSON.stringify(getSettings())).not.toMatch(/k-1|acme-1/);
        expect(Object.fromEntries(fake.secrets)).toEqual({
          [`${KEYCHAIN_PREFIX}echo`]: JSON.stringify({ FAKE_KEY: "k-1" }),
          [`${KEYCHAIN_PREFIX}acme`]: JSON.stringify({ Authorization: "Bearer acme-1" }),
        });
      });

      it(`starts a local server in the vault folder with the agents' shell PATH and its keychain values: ${ISSUE}`, async () => {
        const fake = setUp();

        await fake.add(LOCAL_JSON);

        const [started] = fake.processes;
        expect(started.options).toMatchObject({
          command: "echo-server",
          args: ["--stdio"],
          cwd: "/vault",
          env: { FAKE_KEY: "k-1" },
        });
        expect(started.options.env.PATH).toBe(
          augmentPathForDetection(["/login-shell/bin"], process.env.PATH)
        );
        expect(fake.statusOf("echo")).toEqual(connectedWith("echo", "remember"));
      });

      it("connects a remote server with its headers and counts its tools", async () => {
        const fake = setUp();

        await fake.add(REMOTE_JSON);

        expect(fake.statusOf("acme")).toEqual(connectedWith("search"));
        expect(fake.remote.callsOf("tools/list")[0].token).toBe("acme-1");
      });

      it("leaves every connector unstarted while connectors aren't enabled", () => {
        const fake = setUp({ enabled: false });
        const parsed = fake.custom.parse(LOCAL_JSON);

        fake.custom.add(parsed.ok ? parsed.connectors : []);

        expect(fake.processes).toHaveLength(0);
        expect(fake.statusOf("echo")).toEqual({ kind: "idle" });
      });
    });

    describe("edit()", () => {
      it(`keeps the id and the stored value for a value left blank, and restarts the server with the new config: ${ISSUE}`, async () => {
        const fake = setUp();
        await fake.add(LOCAL_JSON);

        const result = fake.custom.edit(
          "echo",
          JSON.stringify({
            mcpServers: {
              "Echo two": { command: "echo-server", args: ["--v2"], env: { FAKE_KEY: "" } },
            },
          })
        );
        await fake.custom.refresh();

        expect(result.ok).toBe(true);
        expect(getSettings().customConnectors).toEqual([
          {
            id: "echo",
            name: "Echo two",
            command: "echo-server",
            args: ["--v2"],
            envNames: ["FAKE_KEY"],
          },
        ]);
        expect(fake.processes[0].stopped).toBe(true);
        expect(fake.processes[1].options).toMatchObject({
          args: ["--v2"],
          env: { FAKE_KEY: "k-1" },
        });
      });

      it("replaces a stored value with a newly entered one and drops values for removed names", async () => {
        const fake = setUp();
        await fake.add(REMOTE_JSON);

        fake.custom.edit(
          "acme",
          JSON.stringify({ name: "Acme", url: REMOTE_URL, headers: { "X-Key": "x-2" } })
        );

        expect(fake.secrets.get(`${KEYCHAIN_PREFIX}acme`)).toBe(JSON.stringify({ "X-Key": "x-2" }));
      });

      it(`fills a value missing on this device and starts the connector: ${ISSUE}`, async () => {
        const fake = setUp();
        await fake.add(
          JSON.stringify({ name: "Echo", command: "echo-server", env: { FAKE_KEY: "" } })
        );
        expect(fake.statusOf("echo")).toEqual({ kind: "needs-key" });
        expect(fake.custom.getSnapshot().needsAttention).toBe(true);

        fake.custom.edit(
          "echo",
          JSON.stringify({ name: "Echo", command: "echo-server", env: { FAKE_KEY: "k-2" } })
        );
        await fake.custom.refresh();

        expect(fake.statusOf("echo")).toEqual(connectedWith("echo", "remember"));
        expect(fake.custom.getSnapshot().needsAttention).toBe(false);
        expect(fake.processes[fake.processes.length - 1].options.env.FAKE_KEY).toBe("k-2");
      });

      it.each([
        ["invalid JSON", "{", "This isn't valid JSON."],
        [
          "more than one server",
          JSON.stringify({ mcpServers: { A: { command: "a" }, B: { command: "b" } } }),
          "Paste one server to edit this connector.",
        ],
      ])("rejects %s with an inline error and changes nothing", async (_case, text, error) => {
        const fake = setUp();
        await fake.add(LOCAL_JSON);
        const before = getSettings().customConnectors;

        expect(fake.custom.edit("echo", text)).toEqual({ ok: false, error });
        expect(getSettings().customConnectors).toBe(before);
        expect(fake.processes[0].stopped).toBe(false);
      });
    });

    describe("remove()", () => {
      it(`stops the server and deletes its config, its keychain values and its turned-off switch: ${ISSUE}`, async () => {
        const fake = setUp();
        await fake.add(LOCAL_JSON);
        fake.custom.setTurnedOff("echo", true);
        fake.custom.setTurnedOff("echo", false);
        await fake.custom.refresh();

        fake.custom.remove("echo");

        expect(fake.processes.every(({ stopped }) => stopped)).toBe(true);
        expect(getSettings().customConnectors).toEqual([]);
        expect(fake.secrets.size).toBe(0);
        expect(fake.device.get("copilot-custom-connectors-off")).toEqual([]);
        expect(fake.custom.getSnapshot().connectors).toEqual([]);
      });
    });

    describe("setTurnedOff()", () => {
      it(`stops the server and shows it off on this device only, which clears its call for attention: ${ISSUE}`, async () => {
        const fake = setUp();
        await fake.add(LOCAL_JSON);
        await fake.add(JSON.stringify({ name: "Broken", command: "broken" }));
        expect(fake.custom.getSnapshot().needsAttention).toBe(true);

        fake.custom.setTurnedOff("echo", true);
        fake.custom.setTurnedOff("broken", true);

        expect(fake.processes[0].stopped).toBe(true);
        expect(fake.statusOf("echo")).toEqual({ kind: "off" });
        expect(fake.statusOf("broken")).toEqual({ kind: "off" });
        expect(fake.custom.getSnapshot().needsAttention).toBe(false);
        expect(fake.device.get("copilot-custom-connectors-off")).toEqual(["echo", "broken"]);
        expect(getSettings().customConnectors).toHaveLength(2);
      });

      it("starts the server again when turned back on", async () => {
        const fake = setUp();
        await fake.add(LOCAL_JSON);
        fake.custom.setTurnedOff("echo", true);

        fake.custom.setTurnedOff("echo", false);
        await fake.custom.refresh();

        expect(fake.processes).toHaveLength(2);
        expect(fake.statusOf("echo")).toEqual(connectedWith("echo", "remember"));
      });
    });

    describe("storedValueNames()", () => {
      it("names the values this device's keychain holds for a connector, never the values themselves", async () => {
        const fake = setUp();
        await fake.add(
          JSON.stringify({
            mcpServers: {
              Echo: { command: "echo-server", env: { FAKE_KEY: "k-1", FAKE_STORE: "" } },
            },
          })
        );

        expect([...fake.custom.storedValueNames("echo")]).toEqual(["FAKE_KEY"]);
        expect([...fake.custom.storedValueNames("missing")]).toEqual([]);
      });
    });

    describe("statusOf()", () => {
      it("gives a connector's status, and nothing for an unknown connector", async () => {
        const fake = setUp();
        await fake.add(LOCAL_JSON);

        expect(fake.custom.statusOf("echo")).toEqual(connectedWith("echo", "remember"));
        expect(fake.custom.statusOf("missing")).toBeUndefined();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/871 gives a reason that quoted the connector's key with *** in its place, since a chat card's outcome sends the reason to the agent", async () => {
        const fake = setUp();
        jest
          .spyOn(FakeProcess.prototype, "start")
          .mockRejectedValueOnce(new Error("key k-1 was rejected (k-1)"));

        await fake.add(LOCAL_JSON);

        expect(fake.custom.statusOf("echo")).toEqual({
          kind: "couldnt-start",
          reason: "key *** was rejected (***)",
        });
      });
    });

    describe("refresh()", () => {
      it(`shows "Add API key on this device" for a synced connector whose values this device lacks, and doesn't start it: ${ISSUE}`, async () => {
        const fake = setUp();
        setSettings({
          customConnectors: [
            { id: "echo", name: "Echo", command: "echo-server", args: [], envNames: ["FAKE_KEY"] },
          ],
        });

        await fake.custom.refresh();

        expect(fake.statusOf("echo")).toEqual({ kind: "needs-key" });
        expect(fake.processes).toHaveLength(0);
      });

      it(`stops a running server and lists none of its tools once its keychain values are deleted outside Copilot: ${ISSUE}`, async () => {
        const fake = setUp();
        await fake.add(LOCAL_JSON);

        fake.secrets.clear();
        await fake.custom.refresh();

        expect(fake.statusOf("echo")).toEqual({ kind: "needs-key" });
        expect(fake.processes[0].stopped).toBe(true);
        expect(fake.custom.listed()).toEqual([]);
        expect(fake.custom.call("echo_echo", {})).toBeNull();
      });

      it(`shows "Couldn't start" with the server's reason and asks for attention: ${ISSUE}`, async () => {
        const fake = setUp();

        await fake.add(JSON.stringify({ name: "Echo", command: "echo-server" }));

        expect(fake.statusOf("echo")).toEqual({
          kind: "couldnt-start",
          reason: "FAKE_KEY is not set",
        });
        expect(fake.custom.getSnapshot().needsAttention).toBe(true);
        expect(fake.processes[0].stopped).toBe(true);
      });

      it.each([401, 403])(
        `shows "Key not accepted" when a remote server answers %i, and asks for attention: ${ISSUE}`,
        async (status) => {
          const fake = setUp();
          if (status === 401) fake.remote.validTokens.clear();
          else fake.remote.failWithStatus = status;

          await fake.add(REMOTE_JSON);

          expect(fake.statusOf("acme")).toEqual({ kind: "key-not-accepted" });
          expect(fake.custom.getSnapshot().needsAttention).toBe(true);
        }
      );

      it(`shows *** in place of this device's keychain values in the log and the "Couldn't start" reason when a local server echoes its key: ${ISSUE}`, async () => {
        const fake = setUp();

        await fake.add(
          JSON.stringify({ name: "Echo", command: "echo-server", env: { FAKE_KEY: "wrong-key-7" } })
        );

        expect(fake.statusOf("echo")).toEqual({ kind: "couldnt-start", reason: "Invalid key ***" });
        expect(loggedText()).toContain("Invalid key ***");
        expect(loggedText()).not.toContain("wrong-key-7");
      });

      it(`shows *** in place of a header value, and of the key after its scheme, in the log and the reason when a remote server's error echoes them: ${ISSUE}`, async () => {
        const fake = setUp();
        fake.remote.failWithStatus = 400;
        fake.remote.failBody = 'rejected "Bearer acme-1" (token acme-1)';

        await fake.add(REMOTE_JSON);

        expect(fake.statusOf("acme")).toEqual({
          kind: "unreachable",
          reason: 'HTTP 400 rejected "***" (token ***)',
        });
        expect(loggedText()).toContain('rejected "***" (token ***)');
        expect(loggedText()).not.toContain("acme-1");
      });

      it(`logs no part of a keychain entry that isn't readable JSON: ${ISSUE}`, async () => {
        const fake = setUp();
        await fake.add(LOCAL_JSON);

        fake.secrets.set(`${KEYCHAIN_PREFIX}echo`, "sk-live-abcdefghijklmnop");
        await fake.custom.refresh();

        expect(fake.statusOf("echo")).toEqual({ kind: "needs-key" });
        expect(loggedText()).toContain("Couldn't read the keychain values of echo");
        expect(loggedText()).not.toContain("sk-live");
      });

      it(`shows "Couldn't reach" for a remote server that is down, with the network error as its reason and without asking for attention: ${ISSUE}`, async () => {
        const fake = setUp();
        fake.remote.unreachable = true;

        await fake.add(REMOTE_JSON);

        expect(fake.statusOf("acme")).toEqual({ kind: "unreachable", reason: "offline" });
        expect(fake.custom.getSnapshot().needsAttention).toBe(false);
      });

      it("tries a connector that failed again in the next chat", async () => {
        const fake = setUp();
        fake.remote.unreachable = true;
        await fake.add(REMOTE_JSON);
        fake.remote.unreachable = false;

        await fake.custom.refresh();

        expect(fake.statusOf("acme")).toEqual(connectedWith("search"));
      });

      it(`lets a chat start after 10 seconds while a slow server keeps starting: ${ISSUE}`, async () => {
        jest.useFakeTimers();
        const fake = setUp();
        fake.remote.hangs = true;
        const parsed = fake.custom.parse(REMOTE_JSON);
        fake.custom.add(parsed.ok ? parsed.connectors : []);

        const refreshed = fake.custom.refresh();
        await jest.advanceTimersByTimeAsync(10_000);
        await refreshed;

        expect(fake.statusOf("acme")).toEqual({ kind: "starting" });
      });

      it(`restarts a local server that crashes after starting, after a short backoff, and gives up with "Couldn't start" after repeated crashes: ${ISSUE}`, async () => {
        jest.useFakeTimers();
        const fake = setUp();
        await fake.add(LOCAL_JSON);

        fake.processes[0].crash("segfault");
        expect(fake.statusOf("echo")).toEqual({ kind: "starting" });
        expect(textOf(await fake.custom.call("echo_echo", { text: "hi" }))).toContain(
          "isn't running"
        );
        await jest.advanceTimersByTimeAsync(1_000);
        expect(fake.processes).toHaveLength(2);
        expect(fake.statusOf("echo")).toEqual(connectedWith("echo", "remember"));
        expect(textOf(await fake.custom.call("echo_echo", { text: "back" }))).toBe("k-1: back");

        fake.processes[1].crash("segfault");
        await jest.advanceTimersByTimeAsync(2_000);
        fake.processes[2].crash("segfault");
        await jest.advanceTimersByTimeAsync(4_000);
        fake.processes[3].crash("segfault again");

        expect(fake.processes).toHaveLength(4);
        expect(fake.statusOf("echo")).toEqual({ kind: "couldnt-start", reason: "segfault again" });
      });

      it(`shows *** in place of this device's keychain values in the log when a crashed server's last stderr line echoes its key: ${ISSUE}`, async () => {
        const fake = setUp();
        await fake.add(LOCAL_JSON);

        fake.processes[0].crash("auth failed for k-1");

        expect(loggedText()).toContain("auth failed for ***");
        expect(loggedText()).not.toContain("k-1");
        fake.custom.dispose();
      });
    });

    describe("listed()", () => {
      it("lists the tools of connected connectors under <connector>_<tool> names", async () => {
        const fake = setUp();
        await fake.add(LOCAL_JSON);
        await fake.add(JSON.stringify({ name: "Broken", command: "broken" }));

        expect(fake.custom.listed()).toEqual([
          {
            id: "echo",
            definitions: [
              expect.objectContaining({ name: "echo_echo", annotations: { readOnlyHint: true } }),
              expect.objectContaining({ name: "echo_remember" }),
            ],
          },
        ]);
      });
    });

    describe("call()", () => {
      it("forwards a call to the connector's running server", async () => {
        const fake = setUp();
        await fake.add(LOCAL_JSON);

        const result = await fake.custom.call("echo_echo", { text: "hi" });

        expect(result).toEqual({ content: [{ type: "text", text: "k-1: hi" }], isError: false });
      });

      it("returns null for a name no custom connector lists", async () => {
        const fake = setUp();
        await fake.add(LOCAL_JSON);

        expect(fake.custom.call("notion_search", {})).toBeNull();
      });

      it(`moves a remote connector whose key stops working to "Key not accepted" and tells the agent the user must update it: ${ISSUE}`, async () => {
        const fake = setUp();
        await fake.add(REMOTE_JSON);
        fake.remote.validTokens.clear();

        const result = await fake.custom.call("acme_search", {});

        expect(result?.isError).toBe(false);
        expect(textOf(result)).toContain("Settings → Connectors");
        expect(fake.statusOf("acme")).toEqual({ kind: "key-not-accepted" });
      });

      it(`shows *** in place of this device's keychain values in the error returned to the agent when a server's error echoes its key: ${ISSUE}`, async () => {
        const fake = setUp();
        await fake.add(REMOTE_JSON);
        fake.remote.failWithStatus = 400;
        fake.remote.failBody = "unknown token acme-1";

        const text = textOf(await fake.custom.call("acme_search", {}));

        expect(text).toBe("Acme returned an error: HTTP 400 unknown token ***");
      });

      it(`shows *** in place of this device's keychain values in a tool result marked as an error, which is how MCP servers report a failed tool, while a successful result passes through unchanged: ${ISSUE}`, async () => {
        const fake = setUp();
        await fake.add(REMOTE_JSON);
        fake.remote.answer = (_name, args) => ({
          content: [{ type: "text", text: "Rejected token acme-1" }],
          isError: (args as { fail?: boolean }).fail === true,
        });

        const failed = await fake.custom.call("acme_search", { fail: true });
        const succeeded = await fake.custom.call("acme_search", {});

        expect(failed).toEqual({
          content: [{ type: "text", text: "Rejected token ***" }],
          isError: true,
        });
        expect(textOf(succeeded)).toBe("Rejected token acme-1");
      });

      it("moves a remote connector that stops answering to Couldn't reach", async () => {
        const fake = setUp();
        await fake.add(REMOTE_JSON);
        fake.remote.unreachable = true;

        const result = await fake.custom.call("acme_search", {});

        expect(result?.isError).toBe(true);
        expect(fake.statusOf("acme")).toEqual({ kind: "unreachable", reason: "offline" });
      });
    });

    describe("dispose()", () => {
      it(`stops every running server when the plugin unloads: ${ISSUE}`, async () => {
        const fake = setUp();
        await fake.add(LOCAL_JSON);
        await fake.add(JSON.stringify({ name: "Other", command: "other", env: { FAKE_KEY: "o" } }));

        fake.custom.dispose();

        expect(fake.processes.map(({ stopped }) => stopped)).toEqual([true, true]);
      });
    });
  });
});
