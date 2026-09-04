import {
  cleanupLegacyIndexArtifacts,
  type LegacyIndexCleanupAdapter,
  type LegacyIndexCleanupContext,
} from "./legacyIndexRemovalMigration";

const HASH = "0123456789abcdef0123456789abcdef";

interface MemoryAdapter extends LegacyIndexCleanupAdapter {
  remove: jest.MockedFunction<LegacyIndexCleanupAdapter["remove"]>;
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

  return {
    exists: async (path) => directories.has(path),
    list: async (path) => {
      const listing = directories.get(path);
      if (!listing) throw new Error(`missing ${path}`);
      return { files: [...listing.files], folders: [...listing.folders] };
    },
    remove,
  };
}

/**
 * Build a cleanup context with an in-memory device-local marker.
 *
 * @param adapter - Vault adapter under test.
 * @param overrides - Context fields the individual test controls.
 */
function makeContext(
  adapter: LegacyIndexCleanupAdapter,
  overrides: Partial<LegacyIndexCleanupContext> = {}
): LegacyIndexCleanupContext & { marker: { done: boolean } } {
  const marker = { done: false };
  return {
    adapter,
    configDir: ".vault-config",
    hasRun: () => marker.done,
    markRun: () => {
      marker.done = true;
    },
    removeRetiredEmbeddingSecrets: jest.fn(),
    notifyFailure: jest.fn(),
    marker,
    ...overrides,
  };
}

describe("legacyIndexRemovalMigration", () => {
  describe("cleanupLegacyIndexArtifacts()", () => {
    it("deletes exact artifacts in both folders and leaves the emptied directory in place (https://github.com/logancyang/obsidian-copilot/pull/3094#discussion_r3926692778)", async () => {
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
      const context = makeContext(adapter);

      await cleanupLegacyIndexArtifacts(context);

      expect(adapter.remove).toHaveBeenCalledTimes(4);
      expect(adapter.remove).not.toHaveBeenCalledWith(".vault-config/workspace.json");
      expect(await adapter.exists(".copilot-index")).toBe(true);
      expect(context.removeRetiredEmbeddingSecrets).toHaveBeenCalledTimes(1);
      expect(context.marker.done).toBe(true);
    });

    it("keeps user files, malformed names, and nested paths (https://github.com/Brevilabs/obsidian-copilot-private/issues/283)", async () => {
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

      await cleanupLegacyIndexArtifacts(makeContext(adapter));

      expect(adapter.remove).not.toHaveBeenCalled();
    });

    it("visits the shared directory once when the vault config directory uses the legacy folder name (https://github.com/Brevilabs/obsidian-copilot-private/issues/283)", async () => {
      const adapter = makeAdapter({
        ".copilot-index": { files: [`.copilot-index/copilot-index-${HASH}.json`] },
      });

      await cleanupLegacyIndexArtifacts(makeContext(adapter, { configDir: ".copilot-index" }));

      expect(adapter.remove).toHaveBeenCalledTimes(1);
      expect(adapter.remove).toHaveBeenCalledWith(`.copilot-index/copilot-index-${HASH}.json`);
    });

    it("reports a failed folder, cleans the other folder, and retries on the next launch (https://github.com/Brevilabs/obsidian-copilot-private/issues/283)", async () => {
      const adapter = makeAdapter({
        ".copilot-index": { files: [`.copilot-index/copilot-index-${HASH}.json`] },
        ".vault-config": { files: [`.vault-config/copilot-index-${HASH}.json`] },
      });
      adapter.remove.mockRejectedValueOnce(new Error("locked"));
      const context = makeContext(adapter);

      await expect(cleanupLegacyIndexArtifacts(context)).resolves.toBeUndefined();

      expect(context.notifyFailure).toHaveBeenCalledWith(".copilot-index");
      expect(adapter.remove).toHaveBeenCalledWith(`.vault-config/copilot-index-${HASH}.json`);
      expect(context.marker.done).toBe(false);
    });

    it("skips a device that already recorded the cleanup (https://github.com/logancyang/obsidian-copilot/pull/3094#discussion_r3926692787)", async () => {
      const adapter = makeAdapter({
        ".copilot-index": { files: [`.copilot-index/copilot-index-${HASH}.json`] },
      });
      const context = makeContext(adapter, { hasRun: () => true });

      await cleanupLegacyIndexArtifacts(context);

      expect(adapter.remove).not.toHaveBeenCalled();
      expect(context.removeRetiredEmbeddingSecrets).not.toHaveBeenCalled();
    });
  });
});
