import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { installAntigravityLateWorkGuard } from "./antigravityLateWorkGuard";
import { runLateWorkGuard } from "./testing/runLateWorkGuard";
import { pinTempHome, type TempHome } from "./testing/tempHome";

jest.mock("os", () => ({ ...jest.requireActual<object>("os"), homedir: jest.fn() }));

const itWithSh = process.platform === "win32" ? it.skip : it;

const BLOCKED_TOOLS = [
  "invoke_subagent",
  "define_subagent",
  "manage_subagents",
  "schedule",
  "swarm",
  "send_message",
  "run_workflow",
];

const STOP_WITH_WORK_RUNNING = {
  hookEventName: "Stop",
  executionNum: 0,
  fullyIdle: false,
  terminationReason: "NO_TOOL_CALL",
  lastUserInput: "Run `sleep 40` in the background and reply immediately.",
};

interface HookCommand {
  type: string;
  command: string;
  timeout: number;
}

interface CopilotHooks {
  "copilot-no-late-work": {
    PreToolUse: Array<{ matcher: string; hooks: HookCommand[] }>;
    Stop: HookCommand[];
  };
}

describe("antigravityLateWorkGuard", () => {
  describe("installAntigravityLateWorkGuard()", () => {
    let home: TempHome;
    let vault: string;
    let hooksFile: string;
    let scriptFile: string;

    beforeEach(() => {
      home = pinTempHome();
      vault = join(home.homeDir, "vault");
      mkdirSync(vault);
      hooksFile = join(vault, ".agent", "hooks.json");
      scriptFile = join(vault, ".agent", "copilot-guard.sh");
    });

    afterEach(() => home.restore());

    const hooks = () => JSON.parse(readFileSync(hooksFile, "utf8")) as CopilotHooks;

    it("writes a hooks.json that runs the guard before each blocked tool and when a turn is about to end", async () => {
      await installAntigravityLateWorkGuard(vault, "darwin");

      expect(hooks()).toEqual({
        "copilot-no-late-work": {
          PreToolUse: [
            {
              matcher:
                "^(invoke_subagent|define_subagent|manage_subagents|schedule|swarm|send_message|run_workflow)$",
              hooks: [{ type: "command", command: "sh ./copilot-guard.sh deny", timeout: 10 }],
            },
          ],
          Stop: [{ type: "command", command: "sh ./copilot-guard.sh stop", timeout: 60 }],
        },
      });
    });

    it("matches every tool that starts late work by its exact name, and no other tool", async () => {
      await installAntigravityLateWorkGuard(vault, "darwin");
      const matcher = new RegExp(hooks()["copilot-no-late-work"].PreToolUse[0].matcher);

      expect(BLOCKED_TOOLS.filter((name) => matcher.test(name))).toEqual(BLOCKED_TOOLS);
      expect(
        ["run_command", "manage_task", "write_file", "invoke_subagent_v2", "my_schedule"].filter(
          (name) => matcher.test(name)
        )
      ).toEqual([]);
    });

    itWithSh(
      "lets every tool through and never holds a turn in an agy that Copilot did not start",
      async () => {
        await installAntigravityLateWorkGuard(vault, "darwin");

        for (const copilotAcp of [undefined, "0", ""]) {
          expect(
            runLateWorkGuard(vault, "deny", { toolCall: { name: "swarm" } }, copilotAcp).output
          ).toEqual({ decision: "allow" });
          expect(runLateWorkGuard(vault, "stop", STOP_WITH_WORK_RUNNING, copilotAcp)).toEqual({
            output: {},
            sleptSeconds: [],
          });
        }
      }
    );

    itWithSh(
      "denies a blocked tool in Copilot's agy with a reason telling the agent to do the work itself",
      async () => {
        await installAntigravityLateWorkGuard(vault, "darwin");

        expect(
          runLateWorkGuard(vault, "deny", { toolCall: { name: "invoke_subagent" } }, "1").output
        ).toEqual({
          decision: "deny",
          reason:
            "Not available in this chat: subagents, swarms, workflows, timers and scheduled tasks are disabled because their results would arrive after the turn ends and never be shown. Do the work yourself in this turn, or tell the user it is not available here.",
        });
      }
    );

    itWithSh(
      "holds a turn that ends while work it started still runs: waits 30 seconds, then asks the agent to check the work once with manage_task",
      async () => {
        await installAntigravityLateWorkGuard(vault, "darwin");

        const run = runLateWorkGuard(vault, "stop", STOP_WITH_WORK_RUNNING, "1");

        expect(run.sleptSeconds).toEqual(["30"]);
        expect(run.output).toEqual({
          decision: "continue",
          reason:
            "Something you started is still running in the background. This chat cannot show anything that finishes after your turn ends, so do not end the turn yet. Check it once with manage_task. If it has finished, report the result. If it will finish soon, end your reply attempt and you will be asked again. If it is meant to keep running (a server, a watcher, a long job), stop it with manage_task (Action kill) and tell the user that background work is not available in this chat.",
        });
      }
    );

    itWithSh("lets a turn end at once when nothing it started is still running", async () => {
      await installAntigravityLateWorkGuard(vault, "darwin");

      expect(
        runLateWorkGuard(vault, "stop", { ...STOP_WITH_WORK_RUNNING, fullyIdle: true }, "1")
      ).toEqual({ output: {}, sleptSeconds: [] });
    });

    itWithSh(
      "lets a turn end at once when it ends for another reason than the agent replying without a tool call",
      async () => {
        await installAntigravityLateWorkGuard(vault, "darwin");

        expect(
          runLateWorkGuard(
            vault,
            "stop",
            { ...STOP_WITH_WORK_RUNNING, terminationReason: "USER_CANCELLED" },
            "1"
          )
        ).toEqual({ output: {}, sleptSeconds: [] });
      }
    );

    itWithSh(
      "rewrites a hooks.json and guard script an earlier Copilot wrote to the current text",
      async () => {
        mkdirSync(join(vault, ".agent"));
        writeFileSync(hooksFile, '{"copilot-no-late-work":{"Stop":[]}}');
        writeFileSync(scriptFile, "#!/bin/sh\n# Written by Obsidian Copilot.\necho '{}'\n");

        await installAntigravityLateWorkGuard(vault, "darwin");

        expect(hooks()["copilot-no-late-work"].Stop[0].command).toBe("sh ./copilot-guard.sh stop");
        expect(
          runLateWorkGuard(vault, "deny", { toolCall: { name: "swarm" } }, "1").output
        ).toEqual(expect.objectContaining({ decision: "deny" }));
      }
    );

    it("refuses to start and leaves both files untouched when the vault has a hooks.json Copilot did not write", async () => {
      mkdirSync(join(vault, ".agent"));
      const own = '{"my-hooks":{"Stop":[{"type":"command","command":"echo {}"}]}}\n';
      writeFileSync(hooksFile, own);

      await expect(installAntigravityLateWorkGuard(vault, "darwin")).rejects.toThrow(
        ".agent/hooks.json"
      );

      expect(readFileSync(hooksFile, "utf8")).toBe(own);
      expect(existsSync(scriptFile)).toBe(false);
    });

    it("treats a hooks.json that is not a JSON object as not Copilot's", async () => {
      mkdirSync(join(vault, ".agent"));
      writeFileSync(hooksFile, "{ not json");

      await expect(installAntigravityLateWorkGuard(vault, "darwin")).rejects.toThrow(
        ".agent/hooks.json"
      );

      expect(readFileSync(hooksFile, "utf8")).toBe("{ not json");
    });

    it("refuses to start and leaves both files untouched when the vault has a copilot-guard.sh Copilot did not write", async () => {
      mkdirSync(join(vault, ".agent"));
      writeFileSync(scriptFile, "#!/bin/sh\necho mine\n");

      await expect(installAntigravityLateWorkGuard(vault, "darwin")).rejects.toThrow(
        ".agent/copilot-guard.sh"
      );

      expect(readFileSync(scriptFile, "utf8")).toBe("#!/bin/sh\necho mine\n");
      expect(existsSync(hooksFile)).toBe(false);
    });

    it("refuses to start on Windows and writes nothing, since agy there has no sh to run the guard", async () => {
      await expect(installAntigravityLateWorkGuard(vault, "win32")).rejects.toThrow("Windows");

      expect(existsSync(join(vault, ".agent"))).toBe(false);
    });
  });
});
