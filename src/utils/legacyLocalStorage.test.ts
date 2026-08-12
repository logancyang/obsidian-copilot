import { readLegacyLocalStorage } from "@/utils/legacyLocalStorage";

describe("legacyLocalStorage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
  });

  describe("readLegacyLocalStorage()", () => {
    it("returns the raw value stored under the key", () => {
      window.localStorage.setItem("legacy-key", "legacy-value");

      expect(readLegacyLocalStorage("legacy-key")).toBe("legacy-value");
    });

    it("returns null when the key is absent", () => {
      expect(readLegacyLocalStorage("legacy-key")).toBeNull();
    });

    it("returns null when storage reads throw", () => {
      jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("storage disabled");
      });

      expect(readLegacyLocalStorage("legacy-key")).toBeNull();
    });
  });
});
