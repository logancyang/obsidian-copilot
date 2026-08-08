import {
  dismissPopOutHint,
  getHomeShelfTab,
  isPopOutHintDismissed,
  setHomeShelfTab,
} from "@/agentMode/ui/homeShelfPrefs";
import { logWarn } from "@/logger";

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
}));

const mockLogWarn = logWarn as jest.MockedFunction<typeof logWarn>;

describe("homeShelfPrefs", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
  });

  describe("getHomeShelfTab()", () => {
    it("returns null when no tab has been stored", () => {
      expect(getHomeShelfTab("shelf-key")).toBeNull();
    });

    it("returns the stored tab id", () => {
      window.localStorage.setItem("shelf-key", "projects");

      expect(getHomeShelfTab("shelf-key")).toBe("projects");
    });

    it("returns null when storage cannot be read", () => {
      jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("storage disabled");
      });

      expect(getHomeShelfTab("shelf-key")).toBeNull();
    });
  });

  describe("setHomeShelfTab()", () => {
    it("persists the selected tab id", () => {
      setHomeShelfTab("shelf-key", "projects");

      expect(window.localStorage.getItem("shelf-key")).toBe("projects");
    });

    it("does not throw when storage cannot be written", () => {
      jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("storage disabled");
      });

      expect(() => setHomeShelfTab("shelf-key", "projects")).not.toThrow();
      expect(mockLogWarn).toHaveBeenCalledWith(
        "Failed to persist home shelf tab",
        expect.any(Error)
      );
    });
  });

  describe("isPopOutHintDismissed()", () => {
    it("defaults to false when no dismissal has been stored", () => {
      expect(isPopOutHintDismissed()).toBe(false);
    });

    it("returns false when storage cannot be read", () => {
      jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("storage disabled");
      });

      expect(isPopOutHintDismissed()).toBe(false);
    });
  });

  describe("dismissPopOutHint()", () => {
    it("persists the dismissed state", () => {
      dismissPopOutHint();

      expect(isPopOutHintDismissed()).toBe(true);
    });

    it("does not throw when storage cannot be written", () => {
      jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("storage disabled");
      });

      expect(() => dismissPopOutHint()).not.toThrow();
      expect(mockLogWarn).toHaveBeenCalledWith(
        "Failed to persist pop-out hint dismissal",
        expect.any(Error)
      );
    });
  });
});
