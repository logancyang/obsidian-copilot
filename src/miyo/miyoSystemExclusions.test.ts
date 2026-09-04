import { MiyoClient } from "@/miyo/MiyoClient";
import { syncMiyoSystemExclusions } from "@/miyo/miyoSystemExclusions";
import type { CopilotSettings } from "@/settings/model";
import type { App } from "obsidian";

const mockResolveBaseUrl = jest.fn();
const mockGetFolder = jest.fn();
const mockUpdateFolder = jest.fn();

jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: jest.fn().mockImplementation(() => ({
    resolveBaseUrl: mockResolveBaseUrl,
    getFolder: mockGetFolder,
    updateFolder: mockUpdateFolder,
  })),
}));
jest.mock("@/miyo/miyoUtils", () => ({
  getMiyoCustomUrl: (settings: CopilotSettings) => settings.miyoServerUrl,
  getMiyoFolderName: (app: App) => app.vault.getName(),
}));

describe("miyoSystemExclusions", () => {
  const settings = (overrides: Partial<CopilotSettings> = {}): CopilotSettings =>
    ({
      enableMiyo: true,
      miyoServerUrl: "http://miyo.local",
      plusLicenseKey: "license",
      copilotFolder: "team-ai",
      copilotRootHistory: ["copilot", "old-ai"],
      ...overrides,
    }) as CopilotSettings;

  const app = (): App =>
    ({
      vault: { getName: () => "My Vault" },
    }) as unknown as App;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveBaseUrl.mockResolvedValue("http://miyo.local");
    mockUpdateFolder.mockResolvedValue({ path: "My Vault" });
  });

  describe("syncMiyoSystemExclusions()", () => {
    it("preserves Miyo-owned rules while appending every missing Copilot root (https://github.com/Brevilabs/obsidian-copilot-private/issues/284)", async () => {
      mockGetFolder.mockResolvedValue({
        path: "My Vault",
        exclude_folders: ["private", "copilot/"],
      });

      await expect(syncMiyoSystemExclusions(app(), settings())).resolves.toBe(true);

      expect(MiyoClient).toHaveBeenCalledWith({ plusLicenseKey: "license" });
      expect(mockUpdateFolder).toHaveBeenCalledWith("http://miyo.local", "My Vault", {
        exclude_folders: ["private", "copilot/", "team-ai", "old-ai"],
      });
    });

    it("does not PATCH when all system roots are already present (https://github.com/Brevilabs/obsidian-copilot-private/issues/284)", async () => {
      mockGetFolder.mockResolvedValue({
        path: "My Vault",
        exclude_folders: ["private", "copilot", "old-ai", "team-ai"],
      });

      await expect(syncMiyoSystemExclusions(app(), settings())).resolves.toBe(false);

      expect(mockUpdateFolder).not.toHaveBeenCalled();
    });

    it("serializes same-vault merges so concurrent root snapshots cannot overwrite each other (https://github.com/Brevilabs/obsidian-copilot-private/issues/284)", async () => {
      const vaultApp = app();
      let releaseFirstRead: (folder: object) => void = () => undefined;
      mockGetFolder
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseFirstRead = resolve;
            })
        )
        .mockResolvedValueOnce({
          path: "My Vault",
          exclude_folders: ["copilot", "old-ai", "team-ai"],
        });

      const first = syncMiyoSystemExclusions(vaultApp, settings());
      const second = syncMiyoSystemExclusions(vaultApp, settings());
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      expect(mockGetFolder).toHaveBeenCalledTimes(1);
      releaseFirstRead({ path: "My Vault", exclude_folders: [] });

      await expect(first).resolves.toBe(true);
      await expect(second).resolves.toBe(false);
      expect(mockGetFolder).toHaveBeenCalledTimes(2);
      expect(mockUpdateFolder).toHaveBeenCalledTimes(1);
    });
  });
});
