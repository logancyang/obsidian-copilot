import { obsidianDailyReadTool, obsidianRandomReadTool } from "./ObsidianCliDailyTools";
import {
  runDailyReadCommand,
  runRandomReadCommand,
  type ObsidianCliProcessResult,
} from "@/services/obsidianCli/ObsidianCliClient";

jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  runDailyReadCommand: jest.fn(),
  runRandomReadCommand: jest.fn(),
}));

type InvokableTool = { invoke: (args: Record<string, unknown>) => Promise<string> };
const asInvokable = (t: unknown): InvokableTool => t as InvokableTool;

const mockedRunDailyReadCommand = runDailyReadCommand as jest.MockedFunction<
  typeof runDailyReadCommand
>;
const mockedRunRandomReadCommand = runRandomReadCommand as jest.MockedFunction<
  typeof runRandomReadCommand
>;

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
  stderr: string
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

  describe("obsidianDailyReadTool", () => {
    it("returns the daily note content tagged with the requested vault", async () => {
      mockedRunDailyReadCommand.mockResolvedValue(
        buildSuccessResult("daily:read", "Today I worked on CLI integration.")
      );

      const response = await asInvokable(obsidianDailyReadTool).invoke({ vault: "Work" });

      expect(JSON.parse(response)).toMatchObject({
        type: "obsidian_cli_daily_read",
        command: "daily:read",
        vault: "Work",
        content: "Today I worked on CLI integration.",
      });
      expect(mockedRunDailyReadCommand).toHaveBeenCalledWith("Work");
    });

    it("throws the CLI stderr when the command fails", async () => {
      mockedRunDailyReadCommand.mockResolvedValue(
        buildFailedResult("daily:read", "EFAIL", "daily note unavailable")
      );

      await expect(asInvokable(obsidianDailyReadTool).invoke({})).rejects.toThrow(
        "daily note unavailable"
      );
    });
  });

  describe("obsidianRandomReadTool", () => {
    it("returns the random note content with a null vault when none is requested", async () => {
      mockedRunRandomReadCommand.mockResolvedValue(
        buildSuccessResult("random:read", "Random note body")
      );

      const response = await asInvokable(obsidianRandomReadTool).invoke({});

      expect(JSON.parse(response)).toMatchObject({
        type: "obsidian_cli_random_read",
        command: "random:read",
        vault: null,
        content: "Random note body",
      });
      expect(mockedRunRandomReadCommand).toHaveBeenCalledWith(undefined);
    });

    it("throws an actionable binary-not-found message when the CLI is missing (ENOENT)", async () => {
      mockedRunRandomReadCommand.mockResolvedValue(buildFailedResult("random:read", "ENOENT", ""));

      await expect(asInvokable(obsidianRandomReadTool).invoke({})).rejects.toThrow(
        "CLI binary not found"
      );
    });
  });
});
