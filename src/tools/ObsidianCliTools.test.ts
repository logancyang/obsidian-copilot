import {
  obsidianBasesTool,
  obsidianDailyNoteTool,
  obsidianLinksTool,
  obsidianPropertiesTool,
  obsidianTasksTool,
  obsidianTemplatesTool,
} from "./ObsidianCliTools";
import {
  runObsidianCliCommand,
  type ObsidianCliProcessResult,
} from "@/services/obsidianCli/ObsidianCliClient";

jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  runObsidianCliCommand: jest.fn(),
}));

const mockedRunCommand = runObsidianCliCommand as jest.MockedFunction<typeof runObsidianCliCommand>;

type InvokableTool = { invoke: (args: Record<string, unknown>) => Promise<string> };
const asInvokable = (t: unknown): InvokableTool => t as InvokableTool;

type ParsedToolResponse = {
  type?: string;
  command?: string;
  vault?: string | null;
  content?: string;
};

function buildSuccessResult(command: string, stdout: string): ObsidianCliProcessResult {
  return {
    command,
    args: [command],
    binary: "obsidian",
    attemptedBinaries: ["obsidian"],
    ok: true,
    stdout,
    stderr: "",
    exitCode: 0,
    errorCode: null,
    signal: null,
    durationMs: 10,
  };
}

function buildFailedResult(
  command: string,
  errorCode: string,
  stderr: string,
  exitCode: number | null = null
): ObsidianCliProcessResult {
  return {
    command,
    args: [command],
    binary: "obsidian",
    attemptedBinaries: [
      "obsidian",
      "/Applications/Obsidian.app/Contents/MacOS/obsidian",
      "/Applications/Obsidian.app/Contents/MacOS/Obsidian",
    ],
    ok: false,
    stdout: "",
    stderr,
    exitCode,
    errorCode,
    signal: null,
    durationMs: 10,
  };
}

describe("ObsidianCliTools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("obsidianDailyNoteTool", () => {
    it("creates today's daily note by running the daily command", async () => {
      mockedRunCommand.mockResolvedValue(buildSuccessResult("daily", ""));

      const response = await asInvokable(obsidianDailyNoteTool).invoke({ command: "daily" });
      const parsed = JSON.parse(response) as ParsedToolResponse;

      expect(parsed.type).toBe("obsidian_cli_daily_note");
      expect(parsed.command).toBe("daily");
      expect(mockedRunCommand).toHaveBeenCalledWith({
        command: "daily",
        vault: undefined,
        params: {},
      });
    });

    it("returns daily:read content exactly as printed, without trimming", async () => {
      mockedRunCommand.mockResolvedValue(
        buildSuccessResult("daily:read", "# 2026-03-03\n\nToday's tasks...\n")
      );

      const response = await asInvokable(obsidianDailyNoteTool).invoke({ command: "daily:read" });
      const parsed = JSON.parse(response) as ParsedToolResponse;

      expect(parsed.vault).toBeNull();
      expect(parsed.content).toBe("# 2026-03-03\n\nToday's tasks...\n");
    });

    it("returns the trimmed daily:path for the requested vault", async () => {
      mockedRunCommand.mockResolvedValue(buildSuccessResult("daily:path", "Daily/2026-03-03.md\n"));

      const response = await asInvokable(obsidianDailyNoteTool).invoke({
        command: "daily:path",
        vault: "Work",
      });
      const parsed = JSON.parse(response) as ParsedToolResponse;

      expect(parsed.vault).toBe("Work");
      expect(parsed.content).toBe("Daily/2026-03-03.md");
    });

    it("throws the CLI stderr when the command fails", async () => {
      mockedRunCommand.mockResolvedValue(
        buildFailedResult("daily:read", "EFAIL", "Daily note plugin not enabled", 1)
      );

      await expect(
        asInvokable(obsidianDailyNoteTool).invoke({ command: "daily:read" })
      ).rejects.toThrow("Daily note plugin not enabled");
    });

    it("throws an actionable binary-not-found message when the CLI is missing (ENOENT)", async () => {
      mockedRunCommand.mockResolvedValue(buildFailedResult("daily:read", "ENOENT", ""));

      await expect(
        asInvokable(obsidianDailyNoteTool).invoke({ command: "daily:read" })
      ).rejects.toThrow("CLI binary not found");
    });
  });

  describe("obsidianPropertiesTool", () => {
    it("lists vault-wide property names as trimmed content", async () => {
      mockedRunCommand.mockResolvedValue(
        buildSuccessResult("properties", "aliases\nauthor\ndate\ntags\n")
      );

      const response = await asInvokable(obsidianPropertiesTool).invoke({ command: "properties" });
      const parsed = JSON.parse(response) as ParsedToolResponse;

      expect(parsed.type).toBe("obsidian_cli_properties");
      expect(parsed.content).toBe("aliases\nauthor\ndate\ntags");
      expect(mockedRunCommand).toHaveBeenCalledWith({
        command: "properties",
        vault: undefined,
        params: {},
      });
    });

    it("forwards the property name and file to property:read and returns its value", async () => {
      mockedRunCommand.mockResolvedValue(buildSuccessResult("property:read", "project, review"));

      const response = await asInvokable(obsidianPropertiesTool).invoke({
        command: "property:read",
        name: "tags",
        file: "My Note",
      });
      const parsed = JSON.parse(response) as ParsedToolResponse;

      expect(parsed.content).toBe("project, review");
      expect(mockedRunCommand).toHaveBeenCalledWith({
        command: "property:read",
        vault: undefined,
        params: { name: "tags", file: "My Note" },
      });
    });

    it("rejects property:read without a name before running the CLI", async () => {
      await expect(
        asInvokable(obsidianPropertiesTool).invoke({ command: "property:read" })
      ).rejects.toThrow("name is required for property:read");
      expect(mockedRunCommand).not.toHaveBeenCalled();
    });

    it("reports the error code when the CLI fails without stderr", async () => {
      mockedRunCommand.mockResolvedValue(buildFailedResult("properties", "EFAIL", "", 1));

      await expect(
        asInvokable(obsidianPropertiesTool).invoke({ command: "properties" })
      ).rejects.toThrow("error code EFAIL");
    });
  });

  describe("obsidianTasksTool", () => {
    it("returns the task list as trimmed content", async () => {
      mockedRunCommand.mockResolvedValue(
        buildSuccessResult("tasks", "- [ ] Review PR #2181\n- [x] Write tests\n")
      );

      const response = await asInvokable(obsidianTasksTool).invoke({ command: "tasks" });
      const parsed = JSON.parse(response) as ParsedToolResponse;

      expect(parsed.type).toBe("obsidian_cli_tasks");
      expect(parsed.command).toBe("tasks");
      expect(parsed.content).toBe("- [ ] Review PR #2181\n- [x] Write tests");
    });

    it("forwards filter params to the CLI and targets the requested vault", async () => {
      mockedRunCommand.mockResolvedValue(buildSuccessResult("tasks", "- [ ] Task A"));

      await asInvokable(obsidianTasksTool).invoke({
        command: "tasks",
        file: "Project Plan",
        todo: true,
        verbose: true,
        vault: "Work",
      });

      expect(mockedRunCommand).toHaveBeenCalledWith({
        command: "tasks",
        vault: "Work",
        params: { file: "Project Plan", todo: true, verbose: true },
      });
    });

    it("throws the CLI stderr when the command fails", async () => {
      mockedRunCommand.mockResolvedValue(buildFailedResult("tasks", "EFAIL", "Tasks unavailable"));

      await expect(asInvokable(obsidianTasksTool).invoke({ command: "tasks" })).rejects.toThrow(
        "Tasks unavailable"
      );
    });
  });

  describe("obsidianLinksTool", () => {
    it("returns the source files of a note's backlinks", async () => {
      mockedRunCommand.mockResolvedValue(
        buildSuccessResult("backlinks", "Projects/roadmap.md\nDaily/2026-03-01.md")
      );

      const response = await asInvokable(obsidianLinksTool).invoke({
        command: "backlinks",
        file: "My Note",
      });
      const parsed = JSON.parse(response) as ParsedToolResponse;

      expect(parsed.type).toBe("obsidian_cli_links");
      expect(parsed.command).toBe("backlinks");
      expect(parsed.content).toBe("Projects/roadmap.md\nDaily/2026-03-01.md");
      expect(mockedRunCommand).toHaveBeenCalledWith({
        command: "backlinks",
        vault: undefined,
        params: { file: "My Note" },
      });
    });

    it("forwards an explicit false flag instead of dropping it", async () => {
      mockedRunCommand.mockResolvedValue(
        buildSuccessResult("unresolved", "Missing Note\t5\nOld Reference\t2")
      );

      await asInvokable(obsidianLinksTool).invoke({
        command: "unresolved",
        counts: true,
        verbose: false,
      });

      expect(mockedRunCommand).toHaveBeenCalledWith({
        command: "unresolved",
        vault: undefined,
        params: { counts: true, verbose: false },
      });
    });

    it("throws the CLI stderr when the command fails", async () => {
      mockedRunCommand.mockResolvedValue(
        buildFailedResult("backlinks", "EFAIL", 'Error: File "note.md" not found.', 1)
      );

      await expect(
        asInvokable(obsidianLinksTool).invoke({ command: "backlinks", file: "note" })
      ).rejects.toThrow('File "note.md" not found.');
    });
  });

  describe("obsidianTemplatesTool", () => {
    it("lists template names with a null vault when none is requested", async () => {
      mockedRunCommand.mockResolvedValue(
        buildSuccessResult("templates", "Daily Note\nMeeting Notes\nProject Plan")
      );

      const response = await asInvokable(obsidianTemplatesTool).invoke({ command: "templates" });
      const parsed = JSON.parse(response) as ParsedToolResponse;

      expect(parsed.type).toBe("obsidian_cli_templates");
      expect(parsed.vault).toBeNull();
      expect(parsed.content).toBe("Daily Note\nMeeting Notes\nProject Plan");
    });

    it("forwards the template name to template:read and returns its trimmed content", async () => {
      mockedRunCommand.mockResolvedValue(
        buildSuccessResult("template:read", "# {{date}}\n\n## Tasks\n- [ ] ")
      );

      const response = await asInvokable(obsidianTemplatesTool).invoke({
        command: "template:read",
        name: "Daily Note",
      });
      const parsed = JSON.parse(response) as ParsedToolResponse;

      expect(parsed.command).toBe("template:read");
      expect(parsed.content).toBe("# {{date}}\n\n## Tasks\n- [ ]");
      expect(mockedRunCommand).toHaveBeenCalledWith({
        command: "template:read",
        vault: undefined,
        params: { name: "Daily Note" },
      });
    });

    it("rejects template:read without a name before running the CLI", async () => {
      await expect(
        asInvokable(obsidianTemplatesTool).invoke({ command: "template:read" })
      ).rejects.toThrow("name is required for template:read");
      expect(mockedRunCommand).not.toHaveBeenCalled();
    });

    it("throws the CLI stderr when the command fails", async () => {
      mockedRunCommand.mockResolvedValue(
        buildFailedResult("templates", "EFAIL", "Templates plugin not enabled", 1)
      );

      await expect(
        asInvokable(obsidianTemplatesTool).invoke({ command: "templates" })
      ).rejects.toThrow("Templates plugin not enabled");
    });
  });

  describe("obsidianBasesTool", () => {
    it("lists base files with a null vault when none is requested", async () => {
      mockedRunCommand.mockResolvedValue(
        buildSuccessResult("bases", "Contacts.base\nProjects.base\nTasks.base")
      );

      const response = await asInvokable(obsidianBasesTool).invoke({ command: "bases" });
      const parsed = JSON.parse(response) as ParsedToolResponse;

      expect(parsed.type).toBe("obsidian_cli_bases");
      expect(parsed.vault).toBeNull();
      expect(parsed.content).toBe("Contacts.base\nProjects.base\nTasks.base");
    });

    it("forwards file, view and format to base:query and returns the rows", async () => {
      mockedRunCommand.mockResolvedValue(
        buildSuccessResult("base:query", "Name,Status\nAlpha,Active\nBeta,Done")
      );

      const response = await asInvokable(obsidianBasesTool).invoke({
        command: "base:query",
        file: "Projects",
        view: "All Items",
        format: "csv",
      });
      const parsed = JSON.parse(response) as ParsedToolResponse;

      expect(parsed.content).toBe("Name,Status\nAlpha,Active\nBeta,Done");
      expect(mockedRunCommand).toHaveBeenCalledWith({
        command: "base:query",
        vault: undefined,
        params: { file: "Projects", view: "All Items", format: "csv" },
      });
    });

    it("accepts a vault-relative path in place of a file name for base:views", async () => {
      mockedRunCommand.mockResolvedValue(buildSuccessResult("base:views", "Default View"));

      await asInvokable(obsidianBasesTool).invoke({
        command: "base:views",
        path: "Databases/Projects.base",
      });

      expect(mockedRunCommand).toHaveBeenCalledWith({
        command: "base:views",
        vault: undefined,
        params: { path: "Databases/Projects.base" },
      });
    });

    it("forwards file, view, name and content to base:create and returns the created path", async () => {
      mockedRunCommand.mockResolvedValue(
        buildSuccessResult("base:create", "Created: Library/Dune Messiah.md")
      );

      const response = await asInvokable(obsidianBasesTool).invoke({
        command: "base:create",
        file: "Library",
        view: "To Read",
        name: "Dune Messiah",
        content: "A book by Frank Herbert",
      });
      const parsed = JSON.parse(response) as ParsedToolResponse;

      expect(parsed.content).toBe("Created: Library/Dune Messiah.md");
      expect(mockedRunCommand).toHaveBeenCalledWith({
        command: "base:create",
        vault: undefined,
        params: {
          file: "Library",
          view: "To Read",
          name: "Dune Messiah",
          content: "A book by Frank Herbert",
        },
      });
    });

    it.each(["base:views", "base:query", "base:create"])(
      "rejects %s without a file or path before running the CLI",
      async (command) => {
        await expect(asInvokable(obsidianBasesTool).invoke({ command })).rejects.toThrow(
          `file or path is required for ${command}`
        );
        expect(mockedRunCommand).not.toHaveBeenCalled();
      }
    );

    it("throws the CLI stderr when the command fails", async () => {
      mockedRunCommand.mockResolvedValue(
        buildFailedResult("bases", "EFAIL", "Bases plugin not enabled", 1)
      );

      await expect(asInvokable(obsidianBasesTool).invoke({ command: "bases" })).rejects.toThrow(
        "Bases plugin not enabled"
      );
    });
  });
});
