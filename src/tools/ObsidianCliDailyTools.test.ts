import { obsidianDailyReadTool, obsidianRandomReadTool } from "./ObsidianCliDailyTools";
import {
  runDailyReadCommand,
  runRandomReadCommand,
} from "@/services/obsidianCli/ObsidianCliClient";

jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  runDailyReadCommand: jest.fn(),
  runRandomReadCommand: jest.fn(),
}));

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

const mockedRunDailyReadCommand = runDailyReadCommand as jest.MockedFunction<
  typeof runDailyReadCommand
>;
const mockedRunRandomReadCommand = runRandomReadCommand as jest.MockedFunction<
  typeof runRandomReadCommand
>;

/**
 * Build a minimal successful CLI response payload for tool tests.
 *
 * @param command - CLI command identifier.
 * @param stdout - Command output payload.
 * @returns Successful CLI response.
 */
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

/**
 * Build a minimal failed CLI response payload for tool tests.
 *
 * @param command - CLI command identifier.
 * @param errorCode - Process error code.
 * @param stderr - Standard error output.
 * @returns Failed CLI response.
 */
function buildFailedResult(command: string, errorCode: string, stderr: string): CliResult {
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
    exitCode: null,
    errorCode,
    signal: null,
    durationMs: 10,
  };
}

describe("ObsidianCliDailyTools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("obsidianDailyReadTool returns parsed daily note payload", async () => {
    mockedRunDailyReadCommand.mockResolvedValue(
      buildSuccessResult("daily:read", "Today I worked on CLI integration.")
    );

    const response = await (obsidianDailyReadTool as any).invoke({ vault: "Work" });
    const parsed = JSON.parse(response);

    expect(parsed.type).toBe("obsidian_cli_daily_read");
    expect(parsed.command).toBe("daily:read");
    expect(parsed.vault).toBe("Work");
    expect(parsed.content).toBe("Today I worked on CLI integration.");
    expect(mockedRunDailyReadCommand).toHaveBeenCalledWith("Work");
  });

  test("obsidianRandomReadTool returns parsed random note payload", async () => {
    mockedRunRandomReadCommand.mockResolvedValue(
      buildSuccessResult("random:read", "Random note body")
    );

    const response = await (obsidianRandomReadTool as any).invoke({});
    const parsed = JSON.parse(response);

    expect(parsed.type).toBe("obsidian_cli_random_read");
    expect(parsed.command).toBe("random:read");
    expect(parsed.vault).toBeNull();
    expect(parsed.content).toBe("Random note body");
    expect(mockedRunRandomReadCommand).toHaveBeenCalledWith(undefined);
  });

  test("obsidianDailyReadTool throws CLI stderr on failure", async () => {
    mockedRunDailyReadCommand.mockResolvedValue(
      buildFailedResult("daily:read", "EFAIL", "daily note unavailable")
    );

    await expect((obsidianDailyReadTool as any).invoke({})).rejects.toThrow(
      "daily note unavailable"
    );
  });

  test("obsidianRandomReadTool surfaces actionable ENOENT failure details", async () => {
    mockedRunRandomReadCommand.mockResolvedValue(buildFailedResult("random:read", "ENOENT", ""));

    await expect((obsidianRandomReadTool as any).invoke({})).rejects.toThrow(
      "CLI binary not found"
    );
  });
});
