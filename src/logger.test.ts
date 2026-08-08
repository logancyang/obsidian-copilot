import { logFileManager } from "@/logFileManager";
import { logInfo, logTable } from "@/logger";
import { getSettings } from "@/settings/model";

jest.mock("@/logFileManager", () => ({
  logFileManager: {
    append: jest.fn().mockResolvedValue(undefined),
    appendMarkdownBlock: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock("@/settings/model", () => ({ getSettings: jest.fn() }));

describe("logger", () => {
  const append = jest.mocked(logFileManager.append);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getSettings).mockReturnValue({ debug: true } as ReturnType<typeof getSettings>);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("logInfo()", () => {
    it("writes debug output and always appends to the rolling log", () => {
      const debug = jest.spyOn(console, "debug").mockImplementation(() => undefined);

      logInfo("ready", { count: 2 });

      expect(debug).toHaveBeenCalledWith("ready", { count: 2 });
      expect(append).toHaveBeenCalledWith("INFO", "ready", { count: 2 });
    });

    it("still appends when the developer console rejects a log call", () => {
      jest.spyOn(console, "debug").mockImplementation(() => {
        throw new Error("console unavailable");
      });

      expect(() => logInfo("ready")).not.toThrow();
      expect(append).toHaveBeenCalledWith("INFO", "ready");
    });
  });

  describe("logTable()", () => {
    it("projects requested columns before writing structured debug output", () => {
      const debug = jest.spyOn(console, "debug").mockImplementation(() => undefined);
      const rows = [{ hidden: true, name: "Copilot" }];

      logTable(rows, ["name"]);

      expect(debug).toHaveBeenCalledWith([{ name: "Copilot" }]);
      expect(append).not.toHaveBeenCalled();
    });

    it("falls back to the rolling log when structured debug output fails", () => {
      jest.spyOn(console, "debug").mockImplementation(() => {
        throw new Error("console unavailable");
      });
      const rows = [{ name: "Copilot" }];

      expect(() => logTable(rows)).not.toThrow();
      expect(append).toHaveBeenCalledWith("INFO", "Table:", JSON.stringify(rows));
    });
  });
});
