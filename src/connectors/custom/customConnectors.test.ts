import { CustomConnectors } from "@/connectors/custom/customConnectors";
import { fakeKeychain } from "@/connectors/custom/testing/fakeKeychain";
import { getSettings, setSettings } from "@/settings/model";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/862";
const REMOTE_URL = "https://mcp.acme.test/mcp";
const KEYCHAIN_PREFIX = "copilot-vtestvault-custom-connector-";
const OFF_STORAGE_KEY = "copilot-custom-connectors-off";

const LOCAL_JSON = JSON.stringify({
  mcpServers: { Echo: { command: "echo-server", args: ["--stdio"], env: { FAKE_KEY: "k-1" } } },
});
const REMOTE_JSON = JSON.stringify({
  mcpServers: { Acme: { url: REMOTE_URL, headers: { Authorization: "Bearer acme-1" } } },
});

function setUp() {
  setSettings({ customConnectors: [] });
  const { keychain, secrets } = fakeKeychain();
  const device = new Map<string, unknown>();
  const custom = new CustomConnectors({
    keychain,
    deviceStorage: {
      load: (key) => device.get(key) ?? null,
      save: (key, value) => void device.set(key, value),
    },
    catalogIds: ["notion"],
  });
  const statusOf = (id: string) =>
    custom.getSnapshot().connectors.find(({ config }) => config.id === id)?.status;
  const add = (text: string) => {
    const parsed = custom.parse(text);
    if (!parsed.ok) throw new Error(parsed.error);
    custom.add(parsed.connectors);
  };
  return { custom, keychain, secrets, device, statusOf, add };
}

describe("customConnectors", () => {
  describe("CustomConnectors", () => {
    describe("getSnapshot()", () => {
      it(`shows "Add API key on this device" for a synced connector whose values this device lacks, and asks for attention: ${ISSUE}`, () => {
        setSettings({
          customConnectors: [
            { id: "echo", name: "Echo", command: "echo-server", args: [], envNames: ["FAKE_KEY"] },
            { id: "plain", name: "Plain", command: "plain-server", args: [], envNames: [] },
          ],
        });
        const { keychain } = fakeKeychain();

        const custom = new CustomConnectors({
          keychain,
          deviceStorage: { load: () => null, save: jest.fn() },
          catalogIds: [],
        });

        expect(custom.getSnapshot().connectors.map(({ status }) => status)).toEqual([
          { kind: "needs-key" },
          { kind: "idle" },
        ]);
        expect(custom.getSnapshot().needsAttention).toBe(true);
      });

      it("returns the same snapshot until something changes, and tells subscribers when it does", () => {
        const fake = setUp();
        const listener = jest.fn();
        fake.custom.subscribe(listener);
        const before = fake.custom.getSnapshot();

        expect(fake.custom.getSnapshot()).toBe(before);
        fake.add(LOCAL_JSON);

        expect(fake.custom.getSnapshot()).not.toBe(before);
        expect(listener).toHaveBeenCalledTimes(1);
      });
    });

    describe("parse()", () => {
      it("names a connector clear of catalog services and connectors already added", () => {
        const fake = setUp();
        fake.add(LOCAL_JSON);

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
      it(`syncs the config with env and header names only and keeps every value in this device's keychain: ${ISSUE}`, () => {
        const fake = setUp();

        fake.add(LOCAL_JSON);
        fake.add(REMOTE_JSON);

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
        expect(fake.statusOf("echo")).toEqual({ kind: "idle" });
        expect(fake.statusOf("acme")).toEqual({ kind: "idle" });
      });
    });

    describe("edit()", () => {
      it(`keeps the id and the stored value for a value left blank: ${ISSUE}`, () => {
        const fake = setUp();
        fake.add(LOCAL_JSON);

        const result = fake.custom.edit(
          "echo",
          JSON.stringify({
            mcpServers: {
              "Echo two": { command: "echo-server", args: ["--v2"], env: { FAKE_KEY: "" } },
            },
          })
        );

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
        expect(fake.secrets.get(`${KEYCHAIN_PREFIX}echo`)).toBe(
          JSON.stringify({ FAKE_KEY: "k-1" })
        );
        expect(fake.statusOf("echo")).toEqual({ kind: "idle" });
      });

      it("replaces a stored value with a newly entered one and drops values for removed names", () => {
        const fake = setUp();
        fake.add(REMOTE_JSON);

        fake.custom.edit(
          "acme",
          JSON.stringify({ name: "Acme", url: REMOTE_URL, headers: { "X-Key": "x-2" } })
        );

        expect(fake.secrets.get(`${KEYCHAIN_PREFIX}acme`)).toBe(JSON.stringify({ "X-Key": "x-2" }));
      });

      it(`fills a value missing on this device, which clears "Add API key on this device": ${ISSUE}`, () => {
        const fake = setUp();
        fake.add(JSON.stringify({ name: "Echo", command: "echo-server", env: { FAKE_KEY: "" } }));
        expect(fake.statusOf("echo")).toEqual({ kind: "needs-key" });

        fake.custom.edit(
          "echo",
          JSON.stringify({ name: "Echo", command: "echo-server", env: { FAKE_KEY: "k-2" } })
        );

        expect(fake.statusOf("echo")).toEqual({ kind: "idle" });
        expect(fake.custom.getSnapshot().needsAttention).toBe(false);
        expect(fake.secrets.get(`${KEYCHAIN_PREFIX}echo`)).toBe(
          JSON.stringify({ FAKE_KEY: "k-2" })
        );
      });

      it.each([
        ["invalid JSON", "{", "This isn't valid JSON."],
        [
          "more than one server",
          JSON.stringify({ mcpServers: { A: { command: "a" }, B: { command: "b" } } }),
          "Paste one server to edit this connector.",
        ],
      ])("rejects %s with an inline error and changes nothing", (_case, text, error) => {
        const fake = setUp();
        fake.add(LOCAL_JSON);
        const before = getSettings().customConnectors;

        expect(fake.custom.edit("echo", text)).toEqual({ ok: false, error });
        expect(getSettings().customConnectors).toBe(before);
      });
    });

    describe("remove()", () => {
      it(`deletes its config, its keychain values and its turned-off switch: ${ISSUE}`, () => {
        const fake = setUp();
        fake.add(LOCAL_JSON);
        fake.custom.setTurnedOff("echo", true);

        fake.custom.remove("echo");

        expect(getSettings().customConnectors).toEqual([]);
        expect(fake.secrets.size).toBe(0);
        expect(fake.device.get(OFF_STORAGE_KEY)).toEqual([]);
        expect(fake.custom.getSnapshot().connectors).toEqual([]);
      });
    });

    describe("setTurnedOff()", () => {
      it(`shows the connector off on this device only, which clears its call for attention: ${ISSUE}`, () => {
        const fake = setUp();
        fake.add(JSON.stringify({ name: "Echo", command: "echo-server", env: { FAKE_KEY: "" } }));
        expect(fake.custom.getSnapshot().needsAttention).toBe(true);

        fake.custom.setTurnedOff("echo", true);

        expect(fake.statusOf("echo")).toEqual({ kind: "off" });
        expect(fake.custom.getSnapshot().needsAttention).toBe(false);
        expect(fake.device.get(OFF_STORAGE_KEY)).toEqual(["echo"]);
        expect(getSettings().customConnectors).toHaveLength(1);
      });

      it("shows the connector's own status again when turned back on", () => {
        const fake = setUp();
        fake.add(LOCAL_JSON);
        fake.custom.setTurnedOff("echo", true);

        fake.custom.setTurnedOff("echo", false);

        expect(fake.statusOf("echo")).toEqual({ kind: "idle" });
        expect(fake.device.get(OFF_STORAGE_KEY)).toEqual([]);
      });
    });
  });
});
