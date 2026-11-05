import { DEFAULT_SETTINGS } from "@/constants";
import { logWarn } from "@/logger";
import type { MiyoFolderEntry } from "@/miyo/MiyoClient";
import {
  getMiyoSystemExcludedFolders,
  migrateMiyoVaultExclusions,
} from "@/miyo/miyoVaultExclusions";
import { type CopilotSettings, settingsAtom, settingsStore } from "@/settings/model";
import { getVaultBase } from "@/utils/vaultPath";
import type { App } from "obsidian";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/utils/vaultPath", () => ({
  getVaultBase: jest.fn(() => "/Users/me/Vault"),
}));

interface FolderUpdate {
  path: string;
  exclude_folders: string[];
}

const mockMiyo = {
  excludeFolders: [] as string[],
  getFolder: jest.fn<Promise<MiyoFolderEntry | null>, [string, string]>(),
  updateFolder: jest.fn<Promise<MiyoFolderEntry>, [string, FolderUpdate]>(),
};

jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: class {
    resolveBaseUrl = async () => "http://127.0.0.1:8742";
    getFolder = (baseUrl: string, path: string) => mockMiyo.getFolder(baseUrl, path);
    updateFolder = (baseUrl: string, request: FolderUpdate) =>
      mockMiyo.updateFolder(baseUrl, request);
  },
}));

const app = {} as App;

function settingsWith(overrides: Partial<CopilotSettings>): CopilotSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

const DEFAULT_ROOT_SYSTEM_FOLDERS = [
  "copilot/copilot-conversations",
  "copilot/copilot-custom-prompts",
  "copilot/system-prompts",
  "copilot/skills",
  "copilot/memory",
  "copilot/projects/unsupported",
  "copilot/copilot-log.md",
];

describe("miyoVaultExclusions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMiyo.excludeFolders = [];
    mockMiyo.getFolder.mockImplementation(async () => ({
      path: "Vault",
      absolute_path: "/Users/me/Vault",
      exclude_folders: [...mockMiyo.excludeFolders],
    }));
    mockMiyo.updateFolder.mockImplementation(async (_baseUrl: string, request: FolderUpdate) => {
      mockMiyo.excludeFolders = request.exclude_folders;
      return { path: "Vault", exclude_folders: request.exclude_folders };
    });
    settingsStore.set(
      settingsAtom,
      settingsWith({ enableMiyo: true, miyoConnectionMode: "local", copilotFolder: "copilot" })
    );
  });

  describe("getMiyoSystemExcludedFolders()", () => {
    it("excludes each Copilot system sub-folder, the failed project-migration records, and the Copilot log instead of the whole Copilot folder", () => {
      expect(getMiyoSystemExcludedFolders(settingsWith({ copilotFolder: "copilot" }))).toEqual(
        DEFAULT_ROOT_SYSTEM_FOLDERS
      );
    });

    it("leaves the projects folder indexed so project files are searchable and usable as Relevant Notes seeds — https://github.com/Brevilabs/obsidian-copilot-private/issues/847", () => {
      const excluded = getMiyoSystemExcludedFolders(settingsWith({ copilotFolder: "team/ai" }));

      expect(excluded).not.toContain("team/ai/projects");
      expect(excluded).not.toContain("team/ai");
    });

    it("excludes past Copilot folders whole, after the current folder's system sub-folders", () => {
      expect(
        getMiyoSystemExcludedFolders(
          settingsWith({ copilotFolder: "team/ai", copilotRootHistory: ["copilot", "old-ai"] })
        )
      ).toEqual([
        "team/ai/copilot-conversations",
        "team/ai/copilot-custom-prompts",
        "team/ai/system-prompts",
        "team/ai/skills",
        "team/ai/memory",
        "team/ai/projects/unsupported",
        "team/ai/copilot-log.md",
        "copilot",
        "old-ai",
      ]);
    });
  });

  describe("migrateMiyoVaultExclusions()", () => {
    it("replaces a registration's whole-Copilot-folder exclusion with the system sub-folders and keeps the user's own exclusions — https://github.com/Brevilabs/obsidian-copilot-private/issues/847", async () => {
      mockMiyo.excludeFolders = ["private", "copilot", "Archive/2020"];

      await migrateMiyoVaultExclusions(app);

      expect(mockMiyo.getFolder).toHaveBeenCalledWith("http://127.0.0.1:8742", "/Users/me/Vault");
      expect(mockMiyo.updateFolder).toHaveBeenCalledWith("http://127.0.0.1:8742", {
        path: "/Users/me/Vault",
        exclude_folders: ["private", ...DEFAULT_ROOT_SYSTEM_FOLDERS, "Archive/2020"],
      });
    });

    it("keeps excluding past Copilot folders without listing them twice", async () => {
      settingsStore.set(
        settingsAtom,
        settingsWith({
          enableMiyo: true,
          miyoConnectionMode: "local",
          copilotFolder: "team-ai",
          copilotRootHistory: ["copilot"],
        })
      );
      mockMiyo.excludeFolders = ["copilot", "team-ai"];

      await migrateMiyoVaultExclusions(app);

      expect(mockMiyo.excludeFolders).toEqual([
        "copilot",
        "team-ai/copilot-conversations",
        "team-ai/copilot-custom-prompts",
        "team-ai/system-prompts",
        "team-ai/skills",
        "team-ai/memory",
        "team-ai/projects/unsupported",
        "team-ai/copilot-log.md",
      ]);
    });

    it("updates a registration only once across repeated startups", async () => {
      mockMiyo.excludeFolders = ["copilot", "private"];

      await migrateMiyoVaultExclusions(app);
      await migrateMiyoVaultExclusions(app);

      expect(mockMiyo.updateFolder).toHaveBeenCalledTimes(1);
      expect(mockMiyo.excludeFolders).toEqual([...DEFAULT_ROOT_SYSTEM_FOLDERS, "private"]);
    });

    it("keeps a whole-Copilot-folder exclusion the user added back after the update, recognized by the sub-folder exclusions beside it — https://github.com/Brevilabs/obsidian-copilot-private/issues/847", async () => {
      mockMiyo.excludeFolders = [...DEFAULT_ROOT_SYSTEM_FOLDERS, "copilot"];

      await migrateMiyoVaultExclusions(app);

      expect(mockMiyo.updateFolder).not.toHaveBeenCalled();
    });

    it("leaves a registration that never excluded the Copilot folder untouched", async () => {
      mockMiyo.excludeFolders = ["private"];

      await migrateMiyoVaultExclusions(app);

      expect(mockMiyo.updateFolder).not.toHaveBeenCalled();
    });

    it.each([
      ["Miyo is off", { enableMiyo: false }],
      [
        "Copilot connects to a remote Miyo server, where it never registers the vault",
        {
          miyoConnectionMode: "remote" as const,
          miyoServerUrl: "https://mockMiyo.example",
        },
      ],
    ])("does not contact Miyo when %s", async (_condition, overrides) => {
      settingsStore.set(
        settingsAtom,
        settingsWith({ enableMiyo: true, miyoConnectionMode: "local", ...overrides })
      );

      await migrateMiyoVaultExclusions(app);

      expect(mockMiyo.getFolder).not.toHaveBeenCalled();
    });

    it("does not contact Miyo for a vault without a local folder path", async () => {
      jest.mocked(getVaultBase).mockReturnValueOnce(null);

      await migrateMiyoVaultExclusions(app);

      expect(mockMiyo.getFolder).not.toHaveBeenCalled();
    });

    it("leaves a vault Miyo has not registered untouched", async () => {
      mockMiyo.getFolder.mockResolvedValueOnce(null);

      await migrateMiyoVaultExclusions(app);

      expect(mockMiyo.updateFolder).not.toHaveBeenCalled();
      expect(logWarn).not.toHaveBeenCalled();
    });

    it("logs a warning and resolves when Miyo cannot be reached, leaving startup unaffected", async () => {
      mockMiyo.getFolder.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

      await expect(migrateMiyoVaultExclusions(app)).resolves.toBeUndefined();

      expect(mockMiyo.updateFolder).not.toHaveBeenCalled();
      expect(logWarn).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"));
    });
  });
});
