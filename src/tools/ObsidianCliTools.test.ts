import {
  obsidianBasesTool,
  obsidianDailyNoteTool,
  obsidianLinksTool,
  obsidianPropertiesTool,
  obsidianTasksTool,
  obsidianTemplatesTool,
} from "./ObsidianCliTools";
import { runObsidianCliCommand } from "@/services/obsidianCli/ObsidianCliClient";

jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  runObsidianCliCommand: jest.fn(),
}));

const mockedRunCommand = runObsidianCliCommand as jest.MockedFunction<typeof runObsidianCliCommand>;

/**
 * Minimal interface for invoking a LangChain tool in tests.
 * The actual tool's `invoke` is generic; we only need the string-result form here.
 */
type InvokableTool = { invoke: (args: Record<string, unknown>) => Promise<string> };
const asInvokable = (t: unknown): InvokableTool => t as InvokableTool;

type ParsedToolResponse = {
  type?: string;
  command?: string;
  vault?: string | null;
  content?: string;
};

type CliResult = {
  command: string;
  args: string[];
  binary: string;
  attemptedBinaries: string[];
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  errorCode: string | number | null;
  signal: string | null;
  durationMs: number;
};

function buildSuccessResult(command: string, stdout: string): CliResult {
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
): CliResult {
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

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// obsidianDailyNote
// ---------------------------------------------------------------------------

describe("obsidianDailyNoteTool", () => {
  test("daily creates today's daily note", async () => {
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

  test("daily:read returns note content payload", async () => {
    mockedRunCommand.mockResolvedValue(
      buildSuccessResult("daily:read", "# 2026-03-03\n\nToday's tasks...")
    );

    const response = await asInvokable(obsidianDailyNoteTool).invoke({ command: "daily:read" });
    const parsed = JSON.parse(response) as ParsedToolResponse;

    expect(parsed.type).toBe("obsidian_cli_daily_note");
    expect(parsed.command).toBe("daily:read");
    expect(parsed.vault).toBeNull();
    expect(parsed.content).toBe("# 2026-03-03\n\nToday's tasks...");
    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "daily:read",
      vault: undefined,
      params: {},
    });
  });

  test("daily:path returns path payload", async () => {
    mockedRunCommand.mockResolvedValue(buildSuccessResult("daily:path", "Daily/2026-03-03.md"));

    const response = await asInvokable(obsidianDailyNoteTool).invoke({
      command: "daily:path",
      vault: "Work",
    });
    const parsed = JSON.parse(response) as ParsedToolResponse;

    expect(parsed.type).toBe("obsidian_cli_daily_note");
    expect(parsed.command).toBe("daily:path");
    expect(parsed.vault).toBe("Work");
    expect(parsed.content).toBe("Daily/2026-03-03.md");
  });

  test("throws on CLI failure with stderr message", async () => {
    mockedRunCommand.mockResolvedValue(
      buildFailedResult("daily:read", "EFAIL", "Daily note plugin not enabled", 1)
    );

    await expect(
      asInvokable(obsidianDailyNoteTool).invoke({ command: "daily:read" })
    ).rejects.toThrow("Daily note plugin not enabled");
  });

  test("throws ENOENT failure with actionable message", async () => {
    mockedRunCommand.mockResolvedValue(buildFailedResult("daily:read", "ENOENT", ""));

    await expect(
      asInvokable(obsidianDailyNoteTool).invoke({ command: "daily:read" })
    ).rejects.toThrow("CLI binary not found");
  });
});

// ---------------------------------------------------------------------------
// obsidianProperties
// ---------------------------------------------------------------------------

describe("obsidianPropertiesTool", () => {
  test("properties vault-wide returns property list", async () => {
    mockedRunCommand.mockResolvedValue(
      buildSuccessResult("properties", "aliases\nauthor\ndate\ntags")
    );

    const response = await asInvokable(obsidianPropertiesTool).invoke({ command: "properties" });
    const parsed = JSON.parse(response) as ParsedToolResponse;

    expect(parsed.type).toBe("obsidian_cli_properties");
    expect(parsed.command).toBe("properties");
    expect(parsed.content).toBe("aliases\nauthor\ndate\ntags");
    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "properties",
      vault: undefined,
      params: {},
    });
  });

  test("properties passes file and counts params", async () => {
    mockedRunCommand.mockResolvedValue(
      buildSuccessResult("properties", "tags: false\ntitle: My Note")
    );

    await asInvokable(obsidianPropertiesTool).invoke({
      command: "properties",
      file: "My Note",
      counts: true,
    });

    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "properties",
      vault: undefined,
      params: { file: "My Note", counts: true },
    });
  });

  test("property:read returns single property value", async () => {
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

  test("property:read throws when name is missing", async () => {
    await expect(
      asInvokable(obsidianPropertiesTool).invoke({ command: "property:read" })
    ).rejects.toThrow("name is required for property:read");
  });

  test("throws on CLI failure with error code message", async () => {
    // When error code is present, it takes precedence over exit code in error message
    mockedRunCommand.mockResolvedValue(buildFailedResult("properties", "EFAIL", "", 1));

    await expect(
      asInvokable(obsidianPropertiesTool).invoke({ command: "properties" })
    ).rejects.toThrow("error code EFAIL");
  });
});

// ---------------------------------------------------------------------------
// obsidianTasks
// ---------------------------------------------------------------------------

describe("obsidianTasksTool", () => {
  test("tasks returns task list", async () => {
    mockedRunCommand.mockResolvedValue(
      buildSuccessResult("tasks", "- [ ] Review PR #2181\n- [x] Write tests")
    );

    const response = await asInvokable(obsidianTasksTool).invoke({ command: "tasks" });
    const parsed = JSON.parse(response) as ParsedToolResponse;

    expect(parsed.type).toBe("obsidian_cli_tasks");
    expect(parsed.command).toBe("tasks");
    expect(parsed.content).toBe("- [ ] Review PR #2181\n- [x] Write tests");
    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "tasks",
      vault: undefined,
      params: {},
    });
  });

  test("tasks passes all filter params", async () => {
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

  test("tasks with daily flag", async () => {
    mockedRunCommand.mockResolvedValue(buildSuccessResult("tasks", "- [ ] Daily task"));

    await asInvokable(obsidianTasksTool).invoke({ command: "tasks", daily: true });

    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "tasks",
      vault: undefined,
      params: { daily: true },
    });
  });

  test("throws on CLI failure with stderr", async () => {
    mockedRunCommand.mockResolvedValue(buildFailedResult("tasks", "ENOENT", ""));

    await expect(asInvokable(obsidianTasksTool).invoke({ command: "tasks" })).rejects.toThrow(
      "CLI binary not found"
    );
  });
});

// ---------------------------------------------------------------------------
// obsidianLinks
// ---------------------------------------------------------------------------

describe("obsidianLinksTool", () => {
  test("backlinks returns source file list", async () => {
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

  test("links returns outgoing link list", async () => {
    mockedRunCommand.mockResolvedValue(
      buildSuccessResult("links", "Ideas/brainstorm.md\nProjects/roadmap.md")
    );

    await asInvokable(obsidianLinksTool).invoke({ command: "links", path: "Notes/note.md" });

    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "links",
      vault: undefined,
      params: { path: "Notes/note.md" },
    });
  });

  test("orphans returns file list", async () => {
    mockedRunCommand.mockResolvedValue(
      buildSuccessResult("orphans", "Inbox/draft.md\nAttic/old.md")
    );

    const response = await asInvokable(obsidianLinksTool).invoke({ command: "orphans" });
    const parsed = JSON.parse(response) as ParsedToolResponse;

    expect(parsed.content).toBe("Inbox/draft.md\nAttic/old.md");
  });

  test("unresolved passes counts and verbose params", async () => {
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

  test("backlinks with total flag", async () => {
    mockedRunCommand.mockResolvedValue(buildSuccessResult("backlinks", "4"));

    await asInvokable(obsidianLinksTool).invoke({
      command: "backlinks",
      file: "Note",
      total: true,
    });

    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "backlinks",
      vault: undefined,
      params: { file: "Note", total: true },
    });
  });

  test("throws on CLI failure with stderr message", async () => {
    mockedRunCommand.mockResolvedValue(
      buildFailedResult("backlinks", "EFAIL", 'Error: File "note.md" not found.', 1)
    );

    await expect(
      asInvokable(obsidianLinksTool).invoke({ command: "backlinks", file: "note" })
    ).rejects.toThrow('File "note.md" not found.');
  });
});

// ---------------------------------------------------------------------------
// obsidianTemplates
// ---------------------------------------------------------------------------

describe("obsidianTemplatesTool", () => {
  test("templates returns list of template names", async () => {
    mockedRunCommand.mockResolvedValue(
      buildSuccessResult("templates", "Daily Note\nMeeting Notes\nProject Plan")
    );

    const response = await asInvokable(obsidianTemplatesTool).invoke({ command: "templates" });
    const parsed = JSON.parse(response) as ParsedToolResponse;

    expect(parsed.type).toBe("obsidian_cli_templates");
    expect(parsed.command).toBe("templates");
    expect(parsed.vault).toBeNull();
    expect(parsed.content).toBe("Daily Note\nMeeting Notes\nProject Plan");
    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "templates",
      vault: undefined,
      params: {},
    });
  });

  test("templates passes vault param", async () => {
    mockedRunCommand.mockResolvedValue(buildSuccessResult("templates", "Daily Note"));

    await asInvokable(obsidianTemplatesTool).invoke({ command: "templates", vault: "Work" });

    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "templates",
      vault: "Work",
      params: {},
    });
  });

  test("template:read returns template content", async () => {
    mockedRunCommand.mockResolvedValue(
      buildSuccessResult("template:read", "# {{date}}\n\n## Tasks\n- [ ] ")
    );

    const response = await asInvokable(obsidianTemplatesTool).invoke({
      command: "template:read",
      name: "Daily Note",
    });
    const parsed = JSON.parse(response) as ParsedToolResponse;

    expect(parsed.type).toBe("obsidian_cli_templates");
    expect(parsed.command).toBe("template:read");
    expect(parsed.content).toBe("# {{date}}\n\n## Tasks\n- [ ]");
    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "template:read",
      vault: undefined,
      params: { name: "Daily Note" },
    });
  });

  test("template:read throws when name is missing", async () => {
    await expect(
      asInvokable(obsidianTemplatesTool).invoke({ command: "template:read" })
    ).rejects.toThrow("name is required for template:read");
  });

  test("throws on CLI failure with stderr message", async () => {
    mockedRunCommand.mockResolvedValue(
      buildFailedResult("templates", "EFAIL", "Templates plugin not enabled", 1)
    );

    await expect(
      asInvokable(obsidianTemplatesTool).invoke({ command: "templates" })
    ).rejects.toThrow("Templates plugin not enabled");
  });

  test("throws ENOENT failure with actionable message", async () => {
    mockedRunCommand.mockResolvedValue(buildFailedResult("templates", "ENOENT", ""));

    await expect(
      asInvokable(obsidianTemplatesTool).invoke({ command: "templates" })
    ).rejects.toThrow("CLI binary not found");
  });
});

// ---------------------------------------------------------------------------
// obsidianBases
// ---------------------------------------------------------------------------

describe("obsidianBasesTool", () => {
  test("bases lists base files", async () => {
    mockedRunCommand.mockResolvedValue(
      buildSuccessResult("bases", "Contacts.base\nProjects.base\nTasks.base")
    );

    const response = await asInvokable(obsidianBasesTool).invoke({ command: "bases" });
    const parsed = JSON.parse(response) as ParsedToolResponse;

    expect(parsed.type).toBe("obsidian_cli_bases");
    expect(parsed.command).toBe("bases");
    expect(parsed.vault).toBeNull();
    expect(parsed.content).toBe("Contacts.base\nProjects.base\nTasks.base");
    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "bases",
      vault: undefined,
      params: {},
    });
  });

  test("base:views passes file param", async () => {
    mockedRunCommand.mockResolvedValue(
      buildSuccessResult("base:views", "All Items\nBy Status\nKanban")
    );

    const response = await asInvokable(obsidianBasesTool).invoke({
      command: "base:views",
      file: "Projects",
    });
    const parsed = JSON.parse(response) as ParsedToolResponse;

    expect(parsed.type).toBe("obsidian_cli_bases");
    expect(parsed.content).toBe("All Items\nBy Status\nKanban");
    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "base:views",
      vault: undefined,
      params: { file: "Projects" },
    });
  });

  test("base:views passes path param", async () => {
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

  test("base:query passes file, view, and format params", async () => {
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

  test("base:query with total flag", async () => {
    mockedRunCommand.mockResolvedValue(buildSuccessResult("base:query", "42"));

    await asInvokable(obsidianBasesTool).invoke({
      command: "base:query",
      file: "Contacts",
      total: true,
    });

    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "base:query",
      vault: undefined,
      params: { file: "Contacts", total: true },
    });
  });

  test("base:create passes file, view, name, and content params", async () => {
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

    expect(parsed.type).toBe("obsidian_cli_bases");
    expect(parsed.command).toBe("base:create");
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

  test("base:create with path and vault params", async () => {
    mockedRunCommand.mockResolvedValue(buildSuccessResult("base:create", "Created: item.md"));

    await asInvokable(obsidianBasesTool).invoke({
      command: "base:create",
      path: "Databases/Library.base",
      name: "New Item",
      vault: "Work",
    });

    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "base:create",
      vault: "Work",
      params: { path: "Databases/Library.base", name: "New Item" },
    });
  });

  test("base:create with minimal params (file only)", async () => {
    mockedRunCommand.mockResolvedValue(buildSuccessResult("base:create", "Created: Untitled.md"));

    await asInvokable(obsidianBasesTool).invoke({
      command: "base:create",
      file: "Projects",
    });

    expect(mockedRunCommand).toHaveBeenCalledWith({
      command: "base:create",
      vault: undefined,
      params: { file: "Projects" },
    });
  });

  test("base:create throws when file and path are both missing", async () => {
    await expect(asInvokable(obsidianBasesTool).invoke({ command: "base:create" })).rejects.toThrow(
      "file or path is required for base:create"
    );
  });

  test("base:views throws when file and path are both missing", async () => {
    await expect(asInvokable(obsidianBasesTool).invoke({ command: "base:views" })).rejects.toThrow(
      "file or path is required for base:views"
    );
  });

  test("base:query throws when file and path are both missing", async () => {
    await expect(asInvokable(obsidianBasesTool).invoke({ command: "base:query" })).rejects.toThrow(
      "file or path is required for base:query"
    );
  });

  test("throws on CLI failure with stderr message", async () => {
    mockedRunCommand.mockResolvedValue(
      buildFailedResult("bases", "EFAIL", "Bases plugin not enabled", 1)
    );

    await expect(asInvokable(obsidianBasesTool).invoke({ command: "bases" })).rejects.toThrow(
      "Bases plugin not enabled"
    );
  });

  test("throws ENOENT failure with actionable message", async () => {
    mockedRunCommand.mockResolvedValue(buildFailedResult("bases", "ENOENT", ""));

    await expect(asInvokable(obsidianBasesTool).invoke({ command: "bases" })).rejects.toThrow(
      "CLI binary not found"
    );
  });
});
