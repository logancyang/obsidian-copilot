import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { Notice } from "obsidian";

const mockOpenPath = jest.fn();
jest.mock("electron", () => ({ shell: { openPath: mockOpenPath } }), { virtual: true });
jest.mock("obsidian", () => ({ Notice: jest.fn() }));
jest.mock("@/logger", () => ({ logError: jest.fn() }));

describe("openWithSystemDefault", () => {
  describe("openWithSystemDefault()", () => {
    beforeEach(() => jest.clearAllMocks());
    it("https://github.com/logancyang/obsidian-copilot/issues/3121 reports successful OS dispatch", async () => {
      mockOpenPath.mockResolvedValue("");
      await expect(openWithSystemDefault("/tmp/preview.html")).resolves.toBe(true);
      expect(mockOpenPath).toHaveBeenCalledWith("/tmp/preview.html");
      expect(Notice).not.toHaveBeenCalled();
    });
    it("https://github.com/logancyang/obsidian-copilot/issues/3121 reports failed dispatch while retaining the user-facing error", async () => {
      mockOpenPath.mockResolvedValue("No browser available");
      await expect(openWithSystemDefault("/tmp/preview.html")).resolves.toBe(false);
      expect(Notice).toHaveBeenCalledWith("Could not open file: No browser available");
      mockOpenPath.mockRejectedValue(new Error("unavailable"));
      await expect(openWithSystemDefault("/tmp/preview.html")).resolves.toBe(false);
      expect(Notice).toHaveBeenCalledWith("Open this file manually: /tmp/preview.html");
    });
  });
});
