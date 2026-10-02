import { obsidianRandomReadTool } from "./ObsidianCliDailyTools";
import {
  runRandomReadCommand,
  type ObsidianCliProcessResult,
} from "@/services/obsidianCli/ObsidianCliClient";

jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  runRandomReadCommand: jest.fn(),
}));

type InvokableTool = { invoke: (args: Record<string, unknown>) => Promise<string> };
const asInvokable = (t: unknown): InvokableTool => t as InvokableTool;

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
