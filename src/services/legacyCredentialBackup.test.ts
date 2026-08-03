import { backupLegacyCredentials, LEGACY_BACKUP_FILENAME } from "@/services/legacyCredentialBackup";

const PLUGIN_DIR = "vault-config/plugins/copilot";
const BACKUP_PATH = `${PLUGIN_DIR}/${LEGACY_BACKUP_FILENAME}`;

function makeIO(overrides: Partial<{ exists: jest.Mock; write: jest.Mock }> = {}) {
  return {
    exists: overrides.exists ?? jest.fn().mockResolvedValue(false),
    write: overrides.write ?? jest.fn().mockResolvedValue(undefined),
  };
}

describe("legacyCredentialBackup", () => {
  describe("backupLegacyCredentials()", () => {
    it("copies the raw file verbatim when it still holds credentials", async () => {
      const io = makeIO();
      const rawData = {
        openAIApiKey: "sk-legacy",
        enableEncryption: true,
        activeModels: [{ name: "custom", provider: "openai", apiKey: "model-legacy" }],
      };

      const result = await backupLegacyCredentials(rawData, PLUGIN_DIR, io);

      expect(result).toEqual({ status: "backed-up", path: BACKUP_PATH });
      expect(io.write).toHaveBeenCalledWith(BACKUP_PATH, JSON.stringify(rawData, null, 2));
    });

    it("preserves encrypted values without decrypting them", async () => {
      const io = makeIO();

      await backupLegacyCredentials({ openAIApiKey: "enc_desk_abc123" }, PLUGIN_DIR, io);

      expect(io.write.mock.calls[0][1]).toContain("enc_desk_abc123");
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

    it("keeps an existing backup rather than overwriting it", async () => {
      const io = makeIO({ exists: jest.fn().mockResolvedValue(true) });

      const result = await backupLegacyCredentials({ openAIApiKey: "sk-legacy" }, PLUGIN_DIR, io);

      expect(result).toEqual({ status: "backed-up", path: BACKUP_PATH });
      expect(io.write).not.toHaveBeenCalled();
    });

    it("reports failure when the backup cannot be written", async () => {
      const error = new Error("read-only vault");
      const io = makeIO({ write: jest.fn().mockRejectedValue(error) });

      const result = await backupLegacyCredentials({ openAIApiKey: "sk-legacy" }, PLUGIN_DIR, io);

      expect(result).toEqual({ status: "failed", error });
    });
  });
});
