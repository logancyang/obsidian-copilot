import {
  type ObsidianCliProcessResult,
  runObsidianCliArgs,
} from "@/services/obsidianCli/ObsidianCliClient";
import { resolveObsidianCliPath } from "@/services/obsidianCli/obsidianCliPath";
import {
  createObsidianCliCall,
  OBSIDIAN_CLI_TOOL,
  runInRunningObsidian,
} from "@/services/obsidianCli/obsidianCliTool";

jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({ runObsidianCliArgs: jest.fn() }));
jest.mock("@/services/obsidianCli/obsidianCliPath", () => ({ resolveObsidianCliPath: jest.fn() }));
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: () => ({ homedir: () => "/Users/me" }),
}));

const ISSUE_833 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/833";

function processResult(update: Partial<ObsidianCliProcessResult> = {}): ObsidianCliProcessResult {
  return {
    command: "backlinks",
    args: [],
    binary: "obsidian-cli",
    attemptedBinaries: ["obsidian-cli"],
    ok: true,
    stdout: "",
    stderr: "",
    exitCode: 0,
    errorCode: null,
    signal: null,
    durationMs: 5,
    ...update,
  };
}

function setup(result: ObsidianCliProcessResult | Error = processResult()) {
  const run = jest.fn((_command: string, _args: string[]) =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  );
  const call = createObsidianCliCall({
    getVaultName: () => "My Vault",
    hostPluginId: "copilot",
    run,
  });
  return { call, run };
}

describe("obsidianCliTool", () => {
  describe("OBSIDIAN_CLI_TOOL", () => {
    it(`explains template placeholders and forbids ending the host session in its description (${ISSUE_833})`, () => {
      expect(OBSIDIAN_CLI_TOOL.description).toContain(
        "fills {{title}} with the new file name without extension and {{date}}/{{time}} with now"
      );
      expect(OBSIDIAN_CLI_TOOL.description).toContain(
        "Never reload or restart Obsidian, or reload, disable or uninstall Copilot"
      );
      expect(OBSIDIAN_CLI_TOOL.description).not.toMatch(/escalat|sandbox/i);
    });
  });

  describe("createObsidianCliCall()", () => {
    it("runs the command against the hosting vault and returns its output", async () => {
      const { call, run } = setup(processResult({ stdout: "Notes/A.md\nNotes/B.md\n" }));

      await expect(
        call({ args: ["backlinks", "path=Projects/Plan.md", "format=json"] })
      ).resolves.toEqual({ text: "Notes/A.md\nNotes/B.md", isError: false });
      expect(run).toHaveBeenCalledWith("backlinks", [
        "vault=My Vault",
        "backlinks",
        "path=Projects/Plan.md",
        "format=json",
      ]);
    });

    it("reports a command with no output as such instead of an empty reply", async () => {
      const { call } = setup(processResult({ stdout: "\n" }));

      await expect(call({ args: ["daily:append", "content=Hi"] })).resolves.toEqual({
        text: "(no output)",
        isError: false,
      });
    });

    it.each([
      ["no args", {}],
      ["an empty list", { args: [] }],
      ["a non-string arg", { args: ["tabs", 3] }],
      ["only a vault", { args: ["vault=Other"] }],
    ])("rejects %s without running the CLI", async (_case, input) => {
      const { call, run } = setup();

      expect((await call(input)).isError).toBe(true);
      expect(run).not.toHaveBeenCalled();
    });

    it(`drops an agent's own vault= so the CLI always targets the hosting vault (${ISSUE_833})`, async () => {
      const { call, run } = setup();

      await call({ args: ['vault="Other Vault"', "tabs", "ids"] });
      expect(run).toHaveBeenCalledWith("tabs", ["vault=My Vault", "tabs", "ids"]);
    });

    it(`strips shell quotes around a parameter value, since args reach the CLI without a shell (${ISSUE_833})`, async () => {
      const { call, run } = setup();

      await call({ args: ["create", 'path="Daily/My Note.md"', "template='Daily'", "open"] });
      expect(run).toHaveBeenCalledWith("create", [
        "vault=My Vault",
        "create",
        "path=Daily/My Note.md",
        "template=Daily",
        "open",
      ]);
    });

    it.each([
      [["reload"]],
      [["restart"]],
      [["plugins:restrict", "on"]],
      [["plugin:disable", "id=copilot"]],
      [["plugin:reload", 'id="copilot"']],
      [["plugin:uninstall", "id=copilot"]],
      [["command", "id=app:reload"]],
    ])(`refuses %j, which would end the chat hosting the agent (${ISSUE_833})`, async (args) => {
      const { call, run } = setup();

      const result = await call({ args });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("would reload Obsidian or turn off Copilot");
      expect(run).not.toHaveBeenCalled();
    });

    it.each([
      [["plugins:restrict"]],
      [["plugin:reload", "id=dataview"]],
      [["command", "id=app:toggle-left-sidebar"]],
    ])("runs %j, which leaves the host session alone", async (args) => {
      const { call, run } = setup();

      expect((await call({ args })).isError).toBe(false);
      expect(run).toHaveBeenCalled();
    });

    it("returns the CLI's own message with its exit status when the command fails", async () => {
      const { call } = setup(
        processResult({ ok: false, exitCode: 1, stdout: 'Error: File "Nope.md" not found.' })
      );

      await expect(call({ args: ["read", "path=Nope.md"] })).resolves.toEqual({
        text: 'The Obsidian CLI failed (1). Error: File "Nope.md" not found.',
        isError: true,
      });
    });

    it("reports a CLI that could not be started", async () => {
      const { call } = setup(
        new Error("Obsidian CLI commands are only supported in desktop Obsidian.")
      );

      await expect(call({ args: ["tabs"] })).resolves.toEqual({
        text: "The Obsidian CLI could not run: Obsidian CLI commands are only supported in desktop Obsidian.",
        isError: true,
      });
    });

    it(`cuts output over 32,000 bytes at a marked point, since Codex drops the middle of longer MCP output (${ISSUE_833})`, async () => {
      const { call } = setup(processResult({ stdout: "é".repeat(20_000) }));

      const { text, isError } = await call({ args: ["files"] });
      expect(isError).toBe(false);
      expect(text).toMatch(/^é{16000}\n\n\[Output cut at 32000 bytes\./);
    });
  });

  describe("runInRunningObsidian()", () => {
    it("runs the terminal CLI that ships beside the running Obsidian", async () => {
      jest.mocked(resolveObsidianCliPath).mockReturnValue("/Apps/Obsidian.app/MacOS/obsidian-cli");
      jest.mocked(runObsidianCliArgs).mockResolvedValue(processResult());

      await runInRunningObsidian("tabs", ["vault=V", "tabs"]);
      expect(runObsidianCliArgs).toHaveBeenCalledWith("tabs", ["vault=V", "tabs"], {
        binary: "/Apps/Obsidian.app/MacOS/obsidian-cli",
      });
    });

    it("falls back to the CLI's default binary search when no bundled CLI is found", async () => {
      jest.mocked(resolveObsidianCliPath).mockReturnValue(null);
      jest.mocked(runObsidianCliArgs).mockResolvedValue(processResult());

      await runInRunningObsidian("tabs", ["vault=V", "tabs"]);
      expect(runObsidianCliArgs).toHaveBeenCalledWith("tabs", ["vault=V", "tabs"], {
        binary: undefined,
      });
    });
  });
});
