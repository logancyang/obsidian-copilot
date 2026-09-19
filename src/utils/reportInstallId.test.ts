import type { App } from "obsidian";
import { validate as validateUuid, version as uuidVersion } from "uuid";
import { getReportInstallId } from "@/utils/reportInstallId";

const STORAGE_KEY = "obsidian-copilot:report-install-id:v1";

function createVaultStorage() {
  const values = new Map<string, unknown>();
  return {
    values,
    app: {
      loadLocalStorage: jest.fn((key: string) => values.get(key)),
      saveLocalStorage: jest.fn((key: string, value: unknown) => values.set(key, value)),
    } as unknown as App,
  };
}

describe("reportInstallId", () => {
  describe("getReportInstallId()", () => {
    it("persists a UUIDv4 in the vault's device-local storage and reuses it", () => {
      const { app, values } = createVaultStorage();

      const first = getReportInstallId(app);

      expect(validateUuid(first)).toBe(true);
      expect(uuidVersion(first)).toBe(4);
      expect(values.get(STORAGE_KEY)).toBe(first);
      expect(getReportInstallId(app)).toBe(first);
    });

    it("returns the vault's stored UUIDv4 without replacing it", () => {
      const { app, values } = createVaultStorage();
      const stored = "3f2a1d9e-8b4c-4f6d-9e2a-7c5b3a1d9e8f";
      values.set(STORAGE_KEY, stored);

      expect(getReportInstallId(app)).toBe(stored);
      expect(app.saveLocalStorage).not.toHaveBeenCalled();
    });

    it("keeps report identifiers separate for different vaults", () => {
      const firstVault = createVaultStorage();
      const secondVault = createVaultStorage();

      const first = getReportInstallId(firstVault.app);
      const second = getReportInstallId(secondVault.app);

      expect(second).not.toBe(first);
      expect(getReportInstallId(firstVault.app)).toBe(first);
      expect(getReportInstallId(secondVault.app)).toBe(second);
    });

    it.each([
      ["not a uuid at all", "unknown"],
      ["a dashless hex string", "3f2a1d9e8b4c4f6d9e2a7c5b3a1d9e8f"],
      ["a UUID of the wrong version", "2e9c0d84-7f31-11ee-b962-0242ac120002"],
      ["a non-string value", { id: "3f2a1d9e-8b4c-4f6d-9e2a-7c5b3a1d9e8f" }],
    ])(
      "replaces a stored value that is %s, which the server would reject (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)",
      (_label, stored) => {
        const { app, values } = createVaultStorage();
        values.set(STORAGE_KEY, stored);

        const id = getReportInstallId(app);

        expect(id).not.toBe(stored);
        expect(validateUuid(id)).toBe(true);
        expect(uuidVersion(id)).toBe(4);
        expect(values.get(STORAGE_KEY)).toBe(id);
      }
    );

    it("throws when vault storage cannot be read instead of returning a placeholder", () => {
      const { app } = createVaultStorage();
      jest.mocked(app.loadLocalStorage).mockImplementation(() => {
        throw new Error("SecurityError");
      });

      expect(() => getReportInstallId(app)).toThrow("SecurityError");
    });

    it("throws when saving the report identifier fails", () => {
      const { app } = createVaultStorage();
      jest.mocked(app.saveLocalStorage).mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

      expect(() => getReportInstallId(app)).toThrow("QuotaExceededError");
    });

    it("refuses an unpersisted UUID when vault storage silently discards a write (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", () => {
      const { app, values } = createVaultStorage();
      jest.mocked(app.saveLocalStorage).mockImplementation(() => {});

      expect(() => getReportInstallId(app)).toThrow("Report identifier could not be saved.");
      expect(values.has(STORAGE_KEY)).toBe(false);
    });
  });
});
