jest.mock("@/miyo/miyoStatusStore", () => ({
  isMiyoAvailableForCapability: jest.fn(),
  getMiyoStatusSnapshot: jest.fn(),
  refreshMiyoStatus: jest.fn(),
}));

import { Platform, type App } from "obsidian";
import type { CopilotSettings } from "@/settings/model";
import {
  canProcessDocumentsWithMiyo,
  getExtraSearchFolderOptions,
  getMiyoFilePath,
  getMiyoFolderName,
  getSearchBackend,
  getVaultRelativeMiyoPath,
  isCurrentVaultMiyoPath,
  isLocalMiyoUrl,
} from "@/miyo/miyoUtils";
import {
  getMiyoStatusSnapshot,
  isMiyoAvailableForCapability,
  refreshMiyoStatus,
} from "@/miyo/miyoStatusStore";

const capSettings = (over: Partial<CopilotSettings>): CopilotSettings =>
  ({ enableMiyo: false, miyoServerUrl: "", ...over }) as CopilotSettings;

const buildApp = (vaultName: string): App =>
  ({
    vault: {
      getName: () => vaultName,
    },
  }) as unknown as App;

describe("miyoUtils", () => {
  describe("getMiyoFolderName()", () => {
    it("uses the vault folder name even when an adapter exposes an absolute path", () => {
      const folderName = getMiyoFolderName({
        vault: {
          getName: () => "graham-essays-main",
          adapter: {
            getBasePath: () => "\\\\Mac\\Home\\Downloads\\graham-essays-main",
          },
        },
      } as unknown as App);

      expect(folderName).toBe("graham-essays-main");
    });
  });

  describe("getVaultRelativeMiyoPath()", () => {
    it("strips the current vault folder-name prefix", () => {
      expect(getVaultRelativeMiyoPath(buildApp("MyVault"), "MyVault/notes/foo.md")).toBe(
        "notes/foo.md"
      );
    });

    it("returns the normalized path unchanged when the prefix matches a different vault", () => {
      expect(getVaultRelativeMiyoPath(buildApp("MyVault"), "OtherVault/notes/foo.md")).toBe(
        "OtherVault/notes/foo.md"
      );
    });

    it("normalizes separators even when the prefix does not match", () => {
      expect(getVaultRelativeMiyoPath(buildApp("MyVault"), "OtherVault\\notes\\foo.md")).toBe(
        "OtherVault/notes/foo.md"
      );
    });

    it("only strips the leading prefix once", () => {
      expect(getVaultRelativeMiyoPath(buildApp("Test"), "Test/Test/foo.md")).toBe("Test/foo.md");
    });

    it("normalizes backslash separators before stripping", () => {
      expect(getVaultRelativeMiyoPath(buildApp("MyVault"), "MyVault\\notes\\foo.md")).toBe(
        "notes/foo.md"
      );
    });

    it("returns the normalized path when the vault folder name is empty", () => {
      expect(getVaultRelativeMiyoPath(buildApp(""), "notes\\foo.md")).toBe("notes/foo.md");
    });
  });

  describe("isCurrentVaultMiyoPath()", () => {
    it("owns a raw path prefixed with the current vault's folder name", () => {
      expect(isCurrentVaultMiyoPath(buildApp("MyVault"), "MyVault/copilot/x.md")).toBe(true);
    });

    it("disowns a raw path prefixed with another folder's name, even one matching a system root", () => {
      expect(isCurrentVaultMiyoPath(buildApp("MyVault"), "copilot/notes/foo.md")).toBe(false);
    });

    it("claims ownership when no folder name is resolvable (conservative: filters still apply)", () => {
      expect(isCurrentVaultMiyoPath(buildApp(""), "notes/foo.md")).toBe(true);
    });
  });

  describe("getMiyoFilePath()", () => {
    it("prefixes the vault folder name to a vault-relative path", () => {
      expect(getMiyoFilePath(buildApp("MyVault"), "notes/foo.md")).toBe("MyVault/notes/foo.md");
    });

    it("normalizes backslash separators before prefixing", () => {
      expect(getMiyoFilePath(buildApp("MyVault"), "notes\\foo.md")).toBe("MyVault/notes/foo.md");
    });

    it("strips a leading slash from the input so the result has no duplicate separator", () => {
      expect(getMiyoFilePath(buildApp("MyVault"), "/notes/foo.md")).toBe("MyVault/notes/foo.md");
    });

    it("round-trips with getVaultRelativeMiyoPath", () => {
      const app = buildApp("MyVault");
      const original = "notes/foo.md";
      expect(getVaultRelativeMiyoPath(app, getMiyoFilePath(app, original))).toBe(original);
    });

    it("returns the normalized path when the vault folder name is empty", () => {
      expect(getMiyoFilePath(buildApp(""), "notes/foo.md")).toBe("notes/foo.md");
    });
  });

  describe("getExtraSearchFolderOptions()", () => {
    it("offers the other Miyo folders in Miyo's order and marks synced chat folders as chats", () => {
      expect(
        getExtraSearchFolderOptions(
          [
            { path: "Research", origin: "user" },
            { path: "ChatGPT", origin: "chat_sync" },
            { path: "Archive" },
          ],
          "Vault"
        )
      ).toEqual([
        { name: "Research", isChat: false },
        { name: "ChatGPT", isChat: true },
        { name: "Archive", isChat: false },
      ]);
    });

    it("leaves out the vault's own folder, which every Current vault search already covers — https://github.com/logancyang/obsidian-copilot/issues/3508", () => {
      expect(
        getExtraSearchFolderOptions([{ path: "Vault" }, { path: "Research" }], "Vault")
      ).toEqual([{ name: "Research", isChat: false }]);
    });

    it("leaves out names the saved folder list would reject and a name two Miyo folders share, which Miyo rejects as ambiguous — https://github.com/logancyang/obsidian-copilot/issues/3508", () => {
      expect(
        getExtraSearchFolderOptions(
          [
            { path: "Research" },
            { path: "Research", origin: "chat_sync" },
            { path: "Notes" },
            { path: "a/b" },
            { path: " Padded " },
            { path: 'say "hi"' },
          ],
          "Vault"
        )
      ).toEqual([{ name: "Notes", isChat: false }]);
    });
  });

  describe("getSearchBackend()", () => {
    afterEach(() => {
      (Platform as { isMobile: boolean }).isMobile = false;
    });

    it("returns 'miyo' when Miyo is enabled on desktop", () => {
      expect(getSearchBackend(capSettings({ enableMiyo: true }))).toBe("miyo");
    });

    it("returns 'keyword' when Miyo is disabled", () => {
      expect(getSearchBackend(capSettings({ enableMiyo: false }))).toBe("keyword");
    });

    it("returns 'keyword' on mobile without a server URL even when Miyo is enabled", () => {
      (Platform as { isMobile: boolean }).isMobile = true;
      expect(getSearchBackend(capSettings({ enableMiyo: true, miyoServerUrl: "" }))).toBe(
        "keyword"
      );
    });

    it("returns 'miyo' on mobile when a server URL is configured", () => {
      (Platform as { isMobile: boolean }).isMobile = true;
      expect(
        getSearchBackend(capSettings({ enableMiyo: true, miyoServerUrl: "http://host:8742" }))
      ).toBe("miyo");
    });
  });

  describe("canProcessDocumentsWithMiyo()", () => {
    const mockedSnapshot = getMiyoStatusSnapshot as jest.Mock;
    const mockedAvailable = isMiyoAvailableForCapability as jest.Mock;
    const mockedRefresh = refreshMiyoStatus as jest.Mock;
    const miyoSettings = (over: Partial<CopilotSettings> = {}): CopilotSettings =>
      capSettings({ enableMiyo: true, enableMiyoDocumentProcessing: true, ...over });

    beforeEach(() => {
      jest.clearAllMocks();
      mockedSnapshot.mockReturnValue({ documentProcessor: "available" });
      mockedAvailable.mockReturnValue(true);
    });

    it("returns true when Miyo document processing is on and its document processor is available", async () => {
      await expect(canProcessDocumentsWithMiyo(miyoSettings())).resolves.toBe(true);
      expect(mockedRefresh).not.toHaveBeenCalled();
    });

    it("returns false without consulting Miyo when Miyo document processing is off", async () => {
      await expect(
        canProcessDocumentsWithMiyo(miyoSettings({ enableMiyoDocumentProcessing: false }))
      ).resolves.toBe(false);
      expect(mockedRefresh).not.toHaveBeenCalled();
    });

    it("returns false when Miyo document processing is on but Miyo is disabled in settings", async () => {
      await expect(canProcessDocumentsWithMiyo(miyoSettings({ enableMiyo: false }))).resolves.toBe(
        false
      );
    });

    it.each(["unknown", "stale"])(
      "refreshes Miyo status before deciding when the document processor status is %s",
      async (status) => {
        mockedSnapshot.mockReturnValue({ documentProcessor: status });

        await expect(canProcessDocumentsWithMiyo(miyoSettings())).resolves.toBe(true);
        expect(mockedRefresh).toHaveBeenCalledTimes(1);
      }
    );

    it("returns false when the document processor is not available after checking", async () => {
      mockedSnapshot.mockReturnValue({ documentProcessor: "unavailable" });
      mockedAvailable.mockReturnValue(false);

      await expect(canProcessDocumentsWithMiyo(miyoSettings())).resolves.toBe(false);
    });
  });

  describe("isLocalMiyoUrl()", () => {
    it("treats an empty/blank URL as local (discovery)", () => {
      expect(isLocalMiyoUrl("")).toBe(true);
      expect(isLocalMiyoUrl("   ")).toBe(true);
    });

    it("treats loopback hosts as local", () => {
      expect(isLocalMiyoUrl("http://localhost:8742")).toBe(true);
      expect(isLocalMiyoUrl("http://127.0.0.1:8742")).toBe(true);
      expect(isLocalMiyoUrl("http://127.1.2.3:8742")).toBe(true);
      expect(isLocalMiyoUrl("http://[::1]:8742")).toBe(true);
      expect(isLocalMiyoUrl("http://app.localhost:8742")).toBe(true);
    });

    it("treats LAN / public hosts as remote", () => {
      expect(isLocalMiyoUrl("http://192.168.1.10:8742")).toBe(false);
      expect(isLocalMiyoUrl("https://miyo.example.com")).toBe(false);
    });

    it("treats an unparseable URL as remote (safe default)", () => {
      expect(isLocalMiyoUrl("not a url")).toBe(false);
    });
  });
});
