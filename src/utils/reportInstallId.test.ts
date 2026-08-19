import { validate as validateUuid, version as uuidVersion } from "uuid";

const STORAGE_KEY = "obsidian-copilot:report-install-id:v1";

/**
 * The module caches the id for the process lifetime (mirroring `deviceId.ts`),
 * so each case loads a fresh copy instead of sharing one cache — the same
 * isolation idiom `deviceId.test.ts` uses.
 */
async function loadFreshGetReportInstallId(): Promise<() => string> {
  jest.resetModules();
  const mod = await import("@/utils/reportInstallId");
  return mod.getReportInstallId;
}

describe("reportInstallId", () => {
  describe("getReportInstallId()", () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it("mints a UUIDv4 on first use and returns the same id afterwards", async () => {
      const getReportInstallId = await loadFreshGetReportInstallId();

      const first = getReportInstallId();

      expect(validateUuid(first)).toBe(true);
      expect(uuidVersion(first)).toBe(4);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(first);
      expect(getReportInstallId()).toBe(first);
    });

    it("returns a stored well-formed id instead of minting a new one", async () => {
      const stored = "3f2a1d9e-8b4c-4f6d-9e2a-7c5b3a1d9e8f";
      window.localStorage.setItem(STORAGE_KEY, stored);
      const getReportInstallId = await loadFreshGetReportInstallId();

      expect(getReportInstallId()).toBe(stored);
    });

    it.each([
      ["not a uuid at all", "unknown"],
      ["a dashless hex string", "3f2a1d9e8b4c4f6d9e2a7c5b3a1d9e8f"],
      // Valid UUID shape but version 1 — the endpoint requires v4 specifically.
      ["a UUID of the wrong version", "2e9c0d84-7f31-11ee-b962-0242ac120002"],
    ])(
      "replaces a stored value that is %s, which the server would reject",
      async (_label, stored) => {
        window.localStorage.setItem(STORAGE_KEY, stored);
        const getReportInstallId = await loadFreshGetReportInstallId();

        const id = getReportInstallId();

        expect(id).not.toBe(stored);
        expect(validateUuid(id)).toBe(true);
        expect(uuidVersion(id)).toBe(4);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe(id);
      }
    );

    it("throws when storage cannot be read, rather than answering with a placeholder", async () => {
      // Raw, unsanitized: the upload adapter — the one caller — replaces the
      // message wholesale with fixed copy, so this module does not guard the
      // same edge twice.
      const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });
      try {
        const getReportInstallId = await loadFreshGetReportInstallId();
        expect(() => getReportInstallId()).toThrow();
      } finally {
        getItem.mockRestore();
      }
    });

    it("throws when the minted id cannot be persisted, so a per-session id never ships", async () => {
      // A session-scoped random id would satisfy the UUID format while quietly
      // defeating the per-installation rate limit the header exists for.
      const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      try {
        const getReportInstallId = await loadFreshGetReportInstallId();
        expect(() => getReportInstallId()).toThrow();
      } finally {
        setItem.mockRestore();
      }
    });
  });
});
