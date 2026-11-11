import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { App } from "obsidian";
import { COPILOT_PROMPT_BASE } from "@/agentMode/backends/shared/agentSystemPrompt";
import { resetSettings, setSettings } from "@/settings/model";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { ANTIGRAVITY_NOT_SET_UP_MESSAGE, AntigravityBackend } from "./AntigravityBackend";
import { pinTempHome, type TempHome } from "./testing/tempHome";

const APP = {} as App;

const PRO_USAGE = {
  status: "SUCCESS",
  command: {
    name: "usage",
    data: {
      groups: [
        {
          name: "Gemini Models",
          description: "Models within this group: Gemini Flash, Gemini Pro",
          buckets: [
            {
              id: "gemini-weekly",
              window: "weekly",
              remaining_fraction: 0.75,
              reset_time: "2999-11-18T06:24:21Z",
            },
            {
              id: "gemini-5h",
              window: "5h",
              remaining_fraction: 1,
              reset_time: "2999-11-11T11:24:21Z",
            },
          ],
        },
        {
          name: "Claude and GPT models",
          description: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
          buckets: [{ id: "3p-weekly", window: "weekly", remaining_fraction: 0.5 }],
        },
      ],
    },
  },
};

jest.mock("os", () => ({ ...jest.requireActual<object>("os"), homedir: jest.fn() }));
jest.mock("@/utils/binaryPath", () => ({
  ...jest.requireActual<object>("@/utils/binaryPath"),
  WELL_KNOWN_BIN_DIRS: [],
}));
jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  isObsidianCliEnabled: () => false,
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

function saveAntigravitySettings(antigravity?: Record<string, unknown>): void {
  setSettings((current) => ({
    agentMode: {
      ...current.agentMode,
      activeBackend: "antigravity",
      backends: antigravity ? { antigravity } : {},
    },
  }));
}

describe("AntigravityBackend", () => {
  describe("AntigravityBackend", () => {
    describe("buildSpawnDescriptor()", () => {
      let home: TempHome;

      beforeEach(() => {
        home = pinTempHome();
        resetSettings();
      });

      afterEach(() => home.restore());

      it("launches the detected agy as an ACP server with one worker per chat, so it accepts Copilot's MCP server", async () => {
        const agy = home.installAgy();
        saveAntigravitySettings();

        const descriptor = await new AntigravityBackend(APP).buildSpawnDescriptor();

        expect(descriptor.command).toBe(agy);
        expect(descriptor.args).toEqual(["acp", "--process-per-session"]);
      });

      it("passes the user's environment overrides to the agent", async () => {
        const agy = home.installAgy();
        saveAntigravitySettings({ binaryPath: agy, envOverrides: { HTTPS_PROXY: "http://proxy" } });

        const descriptor = await new AntigravityBackend(APP).buildSpawnDescriptor();

        expect(descriptor.env.HTTPS_PROXY).toBe("http://proxy");
      });

      it("refuses to start with a setup hint when agy is not installed", async () => {
        saveAntigravitySettings();

        await expect(new AntigravityBackend(APP).buildSpawnDescriptor()).rejects.toThrow(
          ANTIGRAVITY_NOT_SET_UP_MESSAGE
        );
      });

      it("marks agy as started by Copilot, over any user override, so the vault's late-work guard acts on its chats", async () => {
        const agy = home.installAgy();
        saveAntigravitySettings({ binaryPath: agy, envOverrides: { OBSIDIAN_COPILOT_ACP: "0" } });

        const descriptor = await new AntigravityBackend(APP).buildSpawnDescriptor();

        expect(descriptor.env.OBSIDIAN_COPILOT_ACP).toBe("1");
      });
    });

    describe("prepareSession()", () => {
      let home: TempHome;

      beforeEach(() => {
        home = pinTempHome();
        resetSettings();
      });

      afterEach(() => home.restore());

      it("installs the late-work guard hooks into the vault before each chat starts", async () => {
        await new AntigravityBackend(APP).prepareSession({ vaultBasePath: home.homeDir });

        expect(
          Object.keys(JSON.parse(readFileSync(join(home.homeDir, ".agent", "hooks.json"), "utf8")))
        ).toEqual(["copilot-no-late-work"]);
      });

      it("refuses to start a chat when the vault's hooks.json was not written by Copilot", async () => {
        mkdirSync(join(home.homeDir, ".agent"));
        writeFileSync(join(home.homeDir, ".agent", "hooks.json"), '{"mine":{}}');

        await expect(
          new AntigravityBackend(APP).prepareSession({ vaultBasePath: home.homeDir })
        ).rejects.toThrow("was not written by Copilot");
      });
    });

    describe("newSessionMeta()", () => {
      beforeEach(() => resetSettings());

      it("appends Copilot's agent system prompt to the agent's own", () => {
        const meta = new AntigravityBackend(APP).newSessionMeta() as {
          antigravity: { systemPrompt: { append: string } };
        };

        expect(meta.antigravity.systemPrompt.append).toContain(COPILOT_PROMPT_BASE);
        expect(meta.antigravity.systemPrompt.append).toContain("edit_file/write_file");
      });
    });

    describe("resumeSessionMeta()", () => {
      beforeEach(() => resetSettings());

      it("appends Copilot's agent system prompt again when a chat is reopened", () => {
        const backend = new AntigravityBackend(APP);

        expect(backend.resumeSessionMeta()).toEqual(backend.newSessionMeta());
      });
    });

    describe("presentToolTitle()", () => {
      it("names an edit by the note it changes", () => {
        __resetVaultBaseCache();

        expect(
          new AntigravityBackend(APP).presentToolTitle({
            kind: "edit",
            locations: [{ path: "/v/a.md" }],
          })
        ).toBe("Edit /v/a.md");
      });
    });

    describe("readOriginalFiles()", () => {
      it("reads a completed edit's file text from before the write out of its full-file diff", () => {
        expect(
          new AntigravityBackend(APP).readOriginalFiles({
            toolCallId: "edit",
            status: "completed",
            content: [{ type: "diff", path: "/v/a.md", oldText: "old\n\n", newText: "new\n\n" }],
          })
        ).toEqual({ "/v/a.md": "old\n" });
      });
    });

    describe("readArtifactWrite()", () => {
      let home: TempHome;

      beforeEach(() => {
        home = pinTempHome();
      });

      afterEach(() => home.restore());

      it("reads a plan the agent writes to its brain folder for review", () => {
        const planFile = `${home.homeDir}/.gemini/antigravity-cli/brain/s1/plan.md`;

        expect(
          new AntigravityBackend(APP).readArtifactWrite({
            toolCallId: "plan",
            locations: [{ path: planFile }],
            rawInput: { Content: "# Plan\n", ArtifactMetadata: { RequestFeedback: true } },
          })
        ).toEqual({ kind: "plan", plan: "# Plan\n", planFilePath: planFile });
      });
    });

    describe("readPlanUsage()", () => {
      let home: TempHome;

      beforeEach(() => {
        home = pinTempHome();
        resetSettings();
      });

      afterEach(() => home.restore());

      async function spawnedBackend(script: string): Promise<AntigravityBackend> {
        saveAntigravitySettings({ binaryPath: home.installAgy(script) });
        const backend = new AntigravityBackend(APP);
        await backend.buildSpawnDescriptor();
        return backend;
      }

      it("reads every quota window from agy's /usage report as percent used", async () => {
        const backend = await spawnedBackend(`echo '${JSON.stringify(PRO_USAGE)}'\n`);

        const reading = await backend.readPlanUsage();

        expect(reading.kind === "usage" && reading.planUsage.windows).toEqual([
          {
            id: "gemini-weekly",
            label: "Weekly",
            percent: 25,
            resetsAt: Date.parse("2999-11-18T06:24:21Z"),
          },
          {
            id: "gemini-5h",
            label: "5h",
            percent: 0,
            resetsAt: Date.parse("2999-11-11T11:24:21Z"),
          },
          { id: "3p-weekly", label: "Weekly", percent: 50 },
        ]);
      });

      it("reads usage from an agy not marked as started by Copilot, since /usage starts no agent turn", async () => {
        const marks = `${home.homeDir}/usage-marks`;
        const backend = await spawnedBackend(
          `echo "mark=$OBSIDIAN_COPILOT_ACP" >> '${marks}'\necho '${JSON.stringify(PRO_USAGE)}'\n`
        );

        await backend.readPlanUsage();

        expect(readFileSync(marks, "utf8")).toBe("mark=\n");
      });

      it("reports usage as unavailable when agy fails", async () => {
        const backend = await spawnedBackend("exit 1\n");

        await expect(backend.readPlanUsage()).resolves.toEqual({ kind: "unavailable" });
      });

      it("reuses the last reading without running agy again until a minute has passed", async () => {
        const calls = `${home.homeDir}/usage-calls`;
        const backend = await spawnedBackend(
          `echo run >> '${calls}'\necho '${JSON.stringify(PRO_USAGE)}'\n`
        );
        const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);

        const first = await backend.readPlanUsage();
        now.mockReturnValue(1_000_000 + 59_000);
        const cached = await backend.readPlanUsage();
        now.mockReturnValue(1_000_000 + 61_000);
        await backend.readPlanUsage();

        expect(cached).toEqual(first);
        expect(readFileSync(calls, "utf8").split("\n").filter(Boolean)).toHaveLength(2);
        now.mockRestore();
      });

      it("waits twice as long before each retry after a failed read, up to half an hour", async () => {
        const calls = `${home.homeDir}/usage-calls`;
        const backend = await spawnedBackend(`echo run >> '${calls}'\nexit 1\n`);
        const now = jest.spyOn(Date, "now").mockReturnValue(0);
        const runs = () => readFileSync(calls, "utf8").split("\n").filter(Boolean).length;

        await backend.readPlanUsage();
        now.mockReturnValue(119_000);
        await backend.readPlanUsage();
        const runsWithinFirstBackoff = runs();
        now.mockReturnValue(120_000);
        await backend.readPlanUsage();
        now.mockReturnValue(120_000 + 239_000);
        await backend.readPlanUsage();

        expect(runsWithinFirstBackoff).toBe(1);
        expect(runs()).toBe(2);
        now.mockRestore();
      });

      it("abandons a read in flight when its signal is aborted", async () => {
        const backend = await spawnedBackend("sleep 30\n");
        const controller = new AbortController();

        const reading = backend.readPlanUsage(controller.signal);
        controller.abort();

        await expect(reading).resolves.toEqual({ kind: "unavailable" });
      });

      it("reports usage as unavailable before agy has been launched", async () => {
        await expect(new AntigravityBackend(APP).readPlanUsage()).resolves.toEqual({
          kind: "unavailable",
        });
      });
    });

    describe("selectPlanUsage()", () => {
      let home: TempHome;

      beforeEach(() => {
        home = pinTempHome();
        resetSettings();
      });

      afterEach(() => home.restore());

      it("shows only the quota group that bills the chat's current model", async () => {
        saveAntigravitySettings({
          binaryPath: home.installAgy(`echo '${JSON.stringify(PRO_USAGE)}'\n`),
        });
        const backend = new AntigravityBackend(APP);
        await backend.buildSpawnDescriptor();
        const reading = await backend.readPlanUsage();
        if (reading.kind !== "usage") throw new Error("expected a usage reading");

        const ids = (model: string) =>
          backend.selectPlanUsage(reading.planUsage, model)?.windows.map((w) => w.id) ?? null;

        expect(ids("gemini-3.8-flash")).toEqual(["gemini-weekly", "gemini-5h"]);
        expect(ids("claude-sonnet-5-5")).toEqual(["3p-weekly"]);
        expect(ids("gpt-oss-120b-medium")).toEqual(["3p-weekly"]);
        expect(ids("unknown-model")).toBeNull();
      });
    });
  });
});
