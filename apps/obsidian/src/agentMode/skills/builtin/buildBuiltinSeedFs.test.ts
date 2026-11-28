import { FileSystemAdapter, type App } from "obsidian";
import { buildBuiltinSeedFs } from "./miyoSearchSeed";
import { isDesktopRuntime, requireNodeModule } from "@/utils/desktopRuntime";

jest.mock("@/utils/desktopRuntime", () => ({
  isDesktopRuntime: jest.fn(() => true),
  requireNodeModule: jest.fn(),
}));

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3022";
const root = "skills/example";
const marker = `${root}/SKILL.md`;

function fixture() {
  const files = new Set([marker, `${root}/script.sh`, `${root}/references/personal.md`]);
  const adapter = {
    list: jest.fn(async () => ({
      files: [marker, `${root}/script.sh`],
      folders: [`${root}/references`],
    })),
    remove: jest.fn(async (path: string) => {
      files.delete(path);
    }),
    rmdir: jest.fn(async (path: string) => {
      for (const file of files) if (file.startsWith(`${path}/`)) files.delete(file);
    }),
  };
  return { files, adapter, fs: buildBuiltinSeedFs({ vault: { adapter } } as unknown as App) };
}

describe("buildBuiltinSeedFs", () => {
  describe("buildBuiltinSeedFs()", () => {
    it(`removes user additions before deleting the ownership marker ${ISSUE}`, async () => {
      const f = fixture();
      f.adapter.rmdir.mockImplementation(async (path) => {
        expect(f.files.has(marker)).toBe(true);
        if (path === root) expect([...f.files]).toEqual([marker]);
        for (const file of f.files) if (file.startsWith(`${path}/`)) f.files.delete(file);
      });
      await f.fs.removeDir(root);
      expect(f.files.size).toBe(0);
    });

    it.each(["list", "remove", "rmdir"] as const)(
      `retains ownership after a child cleanup failure at %s and completes on retry ${ISSUE}`,
      async (operation) => {
        const f = fixture();
        f.adapter[operation].mockRejectedValueOnce(new Error("EACCES"));
        await expect(f.fs.removeDir(root)).rejects.toThrow("EACCES");
        expect(f.files.has(marker)).toBe(true);
        await f.fs.removeDir(root);
        expect(f.files.size).toBe(0);
      }
    );

    it(`propagates final directory removal failure ${ISSUE}`, async () => {
      const f = fixture();
      f.adapter.rmdir.mockImplementation(async (path) => {
        if (path === root) throw new Error("EPERM");
        for (const file of f.files) if (file.startsWith(`${path}/`)) f.files.delete(file);
      });
      await expect(f.fs.removeDir(root)).rejects.toThrow("EPERM");
      expect(f.files.has(marker)).toBe(true);
    });

    it(`unlinks a canonical symlink without listing or deleting its target contents ${ISSUE}`, async () => {
      const adapter = Object.assign(new FileSystemAdapter(), {
        getFullPath: jest.fn(() => `/vault/${root}`),
        rmdir: jest.fn().mockResolvedValue(undefined),
      });
      const lstat = jest.fn().mockResolvedValue({ isSymbolicLink: () => true });
      jest.mocked(requireNodeModule).mockReturnValue({ promises: { lstat } });
      await buildBuiltinSeedFs({ vault: { adapter } } as unknown as App).removeDir(root);
      expect(lstat).toHaveBeenCalledWith(`/vault/${root}`);
      expect(adapter.rmdir).toHaveBeenCalledWith(root, true);
      expect(adapter.list).not.toHaveBeenCalled();
      expect(adapter.remove).not.toHaveBeenCalled();
    });

    it(`cleans a real desktop directory after checking that it is not a symlink ${ISSUE}`, async () => {
      const f = fixture();
      const adapter = Object.assign(new FileSystemAdapter(), f.adapter, {
        getFullPath: jest.fn(() => `/vault/${root}`),
      });
      jest.mocked(requireNodeModule).mockReturnValue({
        promises: { lstat: jest.fn().mockResolvedValue({ isSymbolicLink: () => false }) },
      });
      await buildBuiltinSeedFs({ vault: { adapter } } as unknown as App).removeDir(root);
      expect(f.files.size).toBe(0);
    });

    it(`does not walk a canonical directory when its link status cannot be read ${ISSUE}`, async () => {
      const f = fixture();
      const adapter = Object.assign(new FileSystemAdapter(), f.adapter, {
        getFullPath: jest.fn(() => `/vault/${root}`),
      });
      jest.mocked(requireNodeModule).mockReturnValue({
        promises: { lstat: jest.fn().mockRejectedValue(new Error("EACCES")) },
      });
      await expect(
        buildBuiltinSeedFs({ vault: { adapter } } as unknown as App).removeDir(root)
      ).rejects.toThrow("EACCES");
      expect(adapter.list).not.toHaveBeenCalled();
      expect(adapter.rmdir).not.toHaveBeenCalled();
      expect(f.files.has(marker)).toBe(true);
    });

    it(`does not load Node during mobile cleanup ${ISSUE}`, async () => {
      const adapter = Object.assign(new FileSystemAdapter(), {
        rmdir: jest.fn().mockResolvedValue(undefined),
      });
      jest.mocked(isDesktopRuntime).mockReturnValueOnce(false);
      jest.mocked(requireNodeModule).mockClear();
      await buildBuiltinSeedFs({ vault: { adapter } } as unknown as App).removeDir(root);
      expect(requireNodeModule).not.toHaveBeenCalled();
      expect(adapter.rmdir).toHaveBeenCalledWith(root, true);
    });
  });
});
