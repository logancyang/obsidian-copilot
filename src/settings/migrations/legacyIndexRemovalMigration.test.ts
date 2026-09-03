import {
  cleanupLegacyIndexArtifacts,
  type LegacyIndexCleanupAdapter,
} from "./legacyIndexRemovalMigration";

const HASH = "0123456789abcdef0123456789abcdef";

interface MemoryAdapter extends LegacyIndexCleanupAdapter {
  remove: jest.MockedFunction<LegacyIndexCleanupAdapter["remove"]>;
  rmdir: jest.MockedFunction<LegacyIndexCleanupAdapter["rmdir"]>;
}

function makeAdapter(
  initial: Record<string, { files: string[]; folders?: string[] }>
): MemoryAdapter {
  const directories = new Map(
    Object.entries(initial).map(([folder, listing]) => [
      folder,
      { files: [...listing.files], folders: [...(listing.folders ?? [])] },
    ])
  );

  const remove = jest.fn(async (path: string) => {
    for (const listing of directories.values()) {
      listing.files = listing.files.filter((file) => file !== path);
    }
  });
  const rmdir = jest.fn(async (path: string, _recursive: boolean) => {
    directories.delete(path);
  });

  return {
    exists: async (path) => directories.has(path),
    list: async (path) => {
      const listing = directories.get(path);
      if (!listing) throw new Error(`missing ${path}`);
      return { files: [...listing.files], folders: [...listing.folders] };
    },
    remove,
    rmdir,
  };
}

describe("legacyIndexRemovalMigration", () => {
  describe("cleanupLegacyIndexArtifacts()", () => {
    it("deletes exact artifacts in both folders and removes only an empty root index folder (https://github.com/Brevilabs/obsidian-copilot-private/issues/283)", async () => {
      const adapter = makeAdapter({
        ".copilot-index": {
          files: [
            `.copilot-index/copilot-index-${HASH}.json`,
            `.copilot-index/copilot-index-chunk-${HASH}-4.json`,
            `.copilot-index/copilot-index-chunk-${HASH}-metadata.json`,
          ],
        },
        ".vault-config": {
          files: [`.vault-config/copilot-index-${HASH}.json`, ".vault-config/workspace.json"],
        },
      });

      await cleanupLegacyIndexArtifacts({
        adapter,
        configDir: ".vault-config",
        notifyFailure: jest.fn(),
      });

      expect(adapter.remove).toHaveBeenCalledTimes(4);
      expect(adapter.remove).not.toHaveBeenCalledWith(".vault-config/workspace.json");
      expect(adapter.rmdir).toHaveBeenCalledWith(".copilot-index", true);
      expect(adapter.rmdir).not.toHaveBeenCalledWith(".vault-config", expect.anything());
    });

    it("keeps user files, malformed names, nested paths, and a nonempty root folder (https://github.com/Brevilabs/obsidian-copilot-private/issues/283)", async () => {
      const adapter = makeAdapter({
        ".copilot-index": {
          files: [
            ".copilot-index/notes.md",
            `.copilot-index/copilot-index-${HASH.toUpperCase()}.json`,
            `.copilot-index/nested/copilot-index-${HASH}.json`,
          ],
          folders: [".copilot-index/nested"],
        },
        ".vault-config": { files: [] },
      });

      await cleanupLegacyIndexArtifacts({
        adapter,
        configDir: ".vault-config",
        notifyFailure: jest.fn(),
      });

      expect(adapter.remove).not.toHaveBeenCalled();
      expect(adapter.rmdir).not.toHaveBeenCalled();
    });

    it("never removes the folder when the vault config directory uses the legacy folder name (https://github.com/Brevilabs/obsidian-copilot-private/issues/283)", async () => {
      const adapter = makeAdapter({
        ".copilot-index": { files: [`.copilot-index/copilot-index-${HASH}.json`] },
      });

      await cleanupLegacyIndexArtifacts({
        adapter,
        configDir: ".copilot-index",
        notifyFailure: jest.fn(),
      });

      expect(adapter.remove).toHaveBeenCalledWith(`.copilot-index/copilot-index-${HASH}.json`);
      expect(adapter.rmdir).not.toHaveBeenCalled();
    });

    it("reports a failed folder without blocking cleanup of the other folder (https://github.com/Brevilabs/obsidian-copilot-private/issues/283)", async () => {
      const adapter = makeAdapter({
        ".copilot-index": { files: [`.copilot-index/copilot-index-${HASH}.json`] },
        ".vault-config": { files: [`.vault-config/copilot-index-${HASH}.json`] },
      });
      adapter.remove.mockRejectedValueOnce(new Error("locked"));
      const notifyFailure = jest.fn();

      await expect(
        cleanupLegacyIndexArtifacts({ adapter, configDir: ".vault-config", notifyFailure })
      ).resolves.toBeUndefined();

      expect(notifyFailure).toHaveBeenCalledWith(".copilot-index");
      expect(adapter.remove).toHaveBeenCalledWith(`.vault-config/copilot-index-${HASH}.json`);
    });
  });
});
