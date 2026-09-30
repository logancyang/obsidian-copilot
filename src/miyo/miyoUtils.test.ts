jest.mock("@/miyo/miyoStatusStore", () => ({
  isMiyoAvailableForCapability: jest.fn(),
  getMiyoStatusSnapshot: jest.fn(),
  refreshMiyoStatus: jest.fn(),
}));

import { Platform, type App } from "obsidian";
import type { CopilotSettings } from "@/settings/model";
import {
  getMiyoFilePath,
  getMiyoFolderName,
  getSearchBackend,
  getVaultRelativeMiyoPath,
  isCurrentVaultMiyoPath,
  isLocalMiyoUrl,
  resolveDocProcessorBackend,
  seedDocProcessorBackend,
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

  describe("seedDocProcessorBackend()", () => {
    it("returns 'miyo' when self-host mode is valid and Miyo is enabled", () => {
      expect(
        seedDocProcessorBackend(capSettings({ enableSelfHostMode: true, enableMiyo: true }))
      ).toBe("miyo");
    });

    it("returns 'plus' when self-host mode is off", () => {
      expect(
        seedDocProcessorBackend(capSettings({ enableSelfHostMode: false, enableMiyo: true }))
      ).toBe("plus");
    });

    it("returns 'plus' when Miyo is disabled", () => {
      expect(
        seedDocProcessorBackend(capSettings({ enableSelfHostMode: true, enableMiyo: false }))
      ).toBe("plus");
    });
  });

  describe("resolveDocProcessorBackend()", () => {
    const mockedSnapshot = getMiyoStatusSnapshot as jest.Mock;
    const mockedAvailable = isMiyoAvailableForCapability as jest.Mock;
    const mockedRefresh = refreshMiyoStatus as jest.Mock;
    const miyoSettings = (over: Partial<CopilotSettings> = {}): CopilotSettings =>
      capSettings({ enableMiyo: true, docProcessorBackend: "miyo", ...over });

    beforeEach(() => {
      jest.clearAllMocks();
      mockedSnapshot.mockReturnValue({ documentProcessor: "available" });
      mockedAvailable.mockReturnValue(true);
    });

    it("returns 'miyo' when Miyo is selected and its document processor is available", async () => {
      await expect(resolveDocProcessorBackend(miyoSettings())).resolves.toBe("miyo");
      expect(mockedRefresh).not.toHaveBeenCalled();
    });

    it("returns 'plus' without consulting Miyo when another backend is selected", async () => {
      await expect(
        resolveDocProcessorBackend(miyoSettings({ docProcessorBackend: "plus" }))
      ).resolves.toBe("plus");
      expect(mockedRefresh).not.toHaveBeenCalled();
    });

    it("returns 'miyo-unavailable' when Miyo is selected but disabled in settings", async () => {
      await expect(resolveDocProcessorBackend(miyoSettings({ enableMiyo: false }))).resolves.toBe(
        "miyo-unavailable"
      );
    });

    it.each(["unknown", "stale"])(
      "refreshes Miyo status before deciding when the document processor status is %s",
      async (status) => {
        mockedSnapshot.mockReturnValue({ documentProcessor: status });

        await expect(resolveDocProcessorBackend(miyoSettings())).resolves.toBe("miyo");
        expect(mockedRefresh).toHaveBeenCalledTimes(1);
      }
    );

    it("returns 'miyo-unavailable' when the document processor is not available after checking", async () => {
      mockedSnapshot.mockReturnValue({ documentProcessor: "unavailable" });
      mockedAvailable.mockReturnValue(false);

      await expect(resolveDocProcessorBackend(miyoSettings())).resolves.toBe("miyo-unavailable");
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
