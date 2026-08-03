import {
  backupLegacyCredentials,
  legacyBackupFilename,
  LEGACY_BACKUP_PREFIX,
} from "@/services/legacyCredentialBackup";

const PLUGIN_DIR = "vault-config/plugins/copilot";

function backupPathFor(rawData: unknown): string {
  return `${PLUGIN_DIR}/${legacyBackupFilename(JSON.stringify(rawData, null, 2))}`;
}

function makeIO(
  overrides: Partial<{ exists: jest.Mock; write: jest.Mock; rename: jest.Mock }> = {}
) {
  return {
    exists: overrides.exists ?? jest.fn().mockResolvedValue(false),
    write: overrides.write ?? jest.fn().mockResolvedValue(undefined),
    rename: overrides.rename ?? jest.fn().mockResolvedValue(undefined),
  };
}

describe("legacyCredentialBackup", () => {
  describe("legacyBackupFilename()", () => {
    it("names distinct snapshots distinctly and identical ones identically", () => {
      const a = legacyBackupFilename('{"openAIApiKey":"one"}');
      const b = legacyBackupFilename('{"openAIApiKey":"two"}');

      expect(a).not.toBe(b);
      expect(a).toBe(legacyBackupFilename('{"openAIApiKey":"one"}'));
      expect(a.startsWith(LEGACY_BACKUP_PREFIX)).toBe(true);
      expect(a.endsWith(".json")).toBe(true);
    });
  });

  describe("backupLegacyCredentials()", () => {
    it("copies the raw file verbatim when it still holds credentials", async () => {
      const io = makeIO();
      const rawData = {
        openAIApiKey: "sk-legacy",
        enableEncryption: true,
        activeModels: [{ name: "custom", provider: "openai", apiKey: "model-legacy" }],
      };

      const result = await backupLegacyCredentials(rawData, PLUGIN_DIR, io);

      expect(result).toEqual({
        status: "backed-up",
        path: backupPathFor(rawData),
        encrypted: false,
      });
      expect(io.write).toHaveBeenCalledWith(
        `${backupPathFor(rawData)}.writing`,
        JSON.stringify(rawData, null, 2)
      );
      expect(io.rename).toHaveBeenCalledWith(
        `${backupPathFor(rawData)}.writing`,
        backupPathFor(rawData)
      );
    });

    it("preserves encrypted values without decrypting them, and flags them", async () => {
      const io = makeIO();

      const result = await backupLegacyCredentials(
        { openAIApiKey: "enc_desk_abc123" },
        PLUGIN_DIR,
        io
      );

      expect(io.write.mock.calls[0][1]).toContain("enc_desk_abc123");
      // Reason: the flag drives the startup notice, which must not tell these
      // users to delete the file after re-entering values they cannot re-enter.
      expect(result).toMatchObject({ status: "backed-up", encrypted: true });
    });

    it("reports no backup needed when the file holds no credentials", async () => {
      const io = makeIO();

      const result = await backupLegacyCredentials(
        { openAIApiKey: "", activeModels: [{ name: "custom", provider: "openai" }] },
        PLUGIN_DIR,
        io
      );

      expect(result).toEqual({ status: "not-needed" });
      expect(io.write).not.toHaveBeenCalled();
    });

    it("reports no backup needed for a fresh install", async () => {
      const io = makeIO();

      expect(await backupLegacyCredentials(null, PLUGIN_DIR, io)).toEqual({ status: "not-needed" });
      expect(io.write).not.toHaveBeenCalled();
    });

    it("reuses the existing backup when the same snapshot is already saved", async () => {
      const rawData = { openAIApiKey: "sk-legacy" };
      const io = makeIO({ exists: jest.fn().mockResolvedValue(true) });

      const result = await backupLegacyCredentials(rawData, PLUGIN_DIR, io);

      expect(result).toEqual({
        status: "backed-up",
        path: backupPathFor(rawData),
        encrypted: false,
      });
      expect(io.write).not.toHaveBeenCalled();
    });

    it("gives a changed data.json its own backup instead of trusting the earlier one", async () => {
      const earlier = { openAIApiKey: "sk-first" };
      const current = { openAIApiKey: "sk-second" };
      // Reason: a prior launch backed up `earlier` and failed to strip, then
      // Sync delivered `current` from a device still on v3. Treating any
      // existing backup as proof would clear keys no backup holds.
      const io = makeIO({
        exists: jest.fn(async (path: string) => path === backupPathFor(earlier)),
      });

      const result = await backupLegacyCredentials(current, PLUGIN_DIR, io);

      expect(result).toMatchObject({ status: "backed-up", path: backupPathFor(current) });
      expect(io.write).toHaveBeenCalledWith(
        `${backupPathFor(current)}.writing`,
        JSON.stringify(current, null, 2)
      );
    });

    it("never leaves a partial file at the final path when the write is interrupted", async () => {
      const rawData = { openAIApiKey: "sk-legacy" };
      const io = makeIO({ write: jest.fn().mockRejectedValue(new Error("disk full")) });

      const result = await backupLegacyCredentials(rawData, PLUGIN_DIR, io);

      // Reason: a truncated file at the final path would be read as proof on
      // the next launch, and data.json would be stripped against it.
      expect(result.status).toBe("failed");
      expect(io.rename).not.toHaveBeenCalled();
      expect(io.write.mock.calls[0][0]).toBe(`${backupPathFor(rawData)}.writing`);
    });

    it("reports failure when the backup cannot be renamed into place", async () => {
      const error = new Error("rename failed");
      const io = makeIO({ rename: jest.fn().mockRejectedValue(error) });

      const result = await backupLegacyCredentials({ openAIApiKey: "sk-legacy" }, PLUGIN_DIR, io);

      expect(result).toEqual({ status: "failed", error });
    });

    it("reports failure when the backup cannot be written", async () => {
      const error = new Error("read-only vault");
      const io = makeIO({ write: jest.fn().mockRejectedValue(error) });

      const result = await backupLegacyCredentials({ openAIApiKey: "sk-legacy" }, PLUGIN_DIR, io);

      expect(result).toEqual({ status: "failed", error });
    });
  });
});
