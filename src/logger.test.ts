import type { CopilotSettings } from "@/settings/model";

const mockGetSettings = jest.fn<CopilotSettings, []>();

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
}));

const mockAppend = jest.fn<Promise<void>, [string, ...unknown[]]>();
const mockAppendMarkdownBlock = jest.fn<Promise<void>, [string[]]>();

jest.mock("@/logFileManager", () => ({
  logFileManager: {
    append: (level: string, ...args: unknown[]) => mockAppend(level, ...args),
    appendMarkdownBlock: (lines: string[]) => mockAppendMarkdownBlock(lines),
  },
}));

import { logError, logInfo, logMarkdownBlock, logWarn } from "@/logger";

describe("logger", () => {
  let logSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  function setDebug(debug: boolean): void {
    mockGetSettings.mockReturnValue({ debug } as CopilotSettings);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockAppend.mockResolvedValue(undefined);
    mockAppendMarkdownBlock.mockResolvedValue(undefined);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    debugSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("logInfo()", () => {
    it("writes to console.debug rather than console.log when debug is enabled", () => {
      setDebug(true);

      logInfo("retrieved chunks", 3);

      expect(debugSpy).toHaveBeenCalledWith("retrieved chunks", 3);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("leaves the console untouched when debug is disabled", () => {
      setDebug(false);

      logInfo("retrieved chunks");

      expect(debugSpy).not.toHaveBeenCalled();
    });

    it("appends an INFO entry to the rolling log file whether or not debug is enabled", () => {
      setDebug(false);
      logInfo("first");
      setDebug(true);
      logInfo("second");

      expect(mockAppend).toHaveBeenNthCalledWith(1, "INFO", "first");
      expect(mockAppend).toHaveBeenNthCalledWith(2, "INFO", "second");
    });
  });

  describe("logWarn()", () => {
    it("writes to console.warn when debug is enabled and appends a WARN entry either way", () => {
      setDebug(false);
      logWarn("rate limited");
      expect(warnSpy).not.toHaveBeenCalled();

      setDebug(true);
      logWarn("rate limited");

      expect(warnSpy).toHaveBeenCalledWith("rate limited");
      expect(mockAppend).toHaveBeenNthCalledWith(1, "WARN", "rate limited");
      expect(mockAppend).toHaveBeenNthCalledWith(2, "WARN", "rate limited");
    });
  });

  describe("logError()", () => {
    it("writes to console.error when debug is enabled and appends an ERROR entry either way", () => {
      const failure = new Error("boom");

      setDebug(false);
      logError(failure);
      expect(errorSpy).not.toHaveBeenCalled();

      setDebug(true);
      logError(failure);

      expect(errorSpy).toHaveBeenCalledWith(failure);
      expect(mockAppend).toHaveBeenNthCalledWith(1, "ERROR", failure);
      expect(mockAppend).toHaveBeenNthCalledWith(2, "ERROR", failure);
    });
  });

  describe("logMarkdownBlock()", () => {
    it("appends the block to the rolling log file without writing to the console", () => {
      setDebug(true);
      const lines = ["", "| PATH | SCORE |", "| --- | ---: |", ""];

      logMarkdownBlock(lines);

      expect(mockAppendMarkdownBlock).toHaveBeenCalledWith(lines);
      expect(debugSpy).not.toHaveBeenCalled();
    });
  });
});
