import { registerCommands } from "@/commands";
import { COMMAND_ICONS, COMMAND_IDS, COMMAND_NAMES } from "@/constants";
import type CopilotPlugin from "@/main";
import { MiyoRequestError } from "@/miyo/MiyoClient";
import { getSettings } from "@/settings/model";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { waitFor } from "@testing-library/react";
import { Notice, TFile, type Command } from "obsidian";

const mockResolveBaseUrl = jest.fn();
const mockScanFolder = jest.fn();

jest.mock("@/commands/CustomCommandChatModal", () => ({
  CustomCommandChatModal: jest.fn(),
}));
jest.mock("@/utils/desktopRuntime", () => ({
  isDesktopRuntime: jest.fn(() => false),
}));
jest.mock("@/settings/model", () => ({
  ...jest.requireActual<typeof import("@/settings/model")>("@/settings/model"),
  getSettings: jest.fn(),
}));
jest.mock("@/miyo/miyoUtils", () => ({
  getMiyoCustomUrl: jest.fn((settings: { miyoServerUrl?: string }) => settings.miyoServerUrl ?? ""),
  getMiyoFolderName: jest.fn(() => "Test Vault"),
}));
jest.mock("@/miyo/MiyoClient", () => {
  class MockMiyoRequestError extends Error {
    public constructor(
      public readonly status: number,
      public readonly detail: string
    ) {
      super(detail);
    }
  }
  return {
    MiyoRequestError: MockMiyoRequestError,
    MiyoClient: jest.fn().mockImplementation(() => ({
      resolveBaseUrl: mockResolveBaseUrl,
      scanFolder: mockScanFolder,
    })),
  };
});

function markdownFile(path: string): TFile {
  const TFileConstructor = TFile as unknown as new (path: string) => TFile;
  return new TFileConstructor(path);
}

describe("commands", () => {
  describe("registerCommands()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.mocked(getSettings).mockReturnValue({
        enableMiyo: false,
        miyoServerUrl: "",
      } as ReturnType<typeof getSettings>);
      mockResolveBaseUrl.mockResolvedValue("http://127.0.0.1:8742");
      mockScanFolder.mockResolvedValue({ status: "started" });
    });

    it("registers the new Quick Chat command with a name distinct from Agent Chat", () => {
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        app: { workspace: { getActiveFile: jest.fn(() => null) } },
      } as unknown as CopilotPlugin;

      registerCommands(plugin, jest.fn());

      const command = commands.find(({ id }) => id === COMMAND_IDS.NEW_CHAT);
      expect(command?.name).toBe("New Copilot Quick Chat");
      expect(command?.name).not.toBe(COMMAND_NAMES[COMMAND_IDS.NEW_AGENT_CHAT]);
    });

    it("registers the OpenArtifacts palette command and publishes the active Markdown file", () => {
      const activeFile = markdownFile("Notes/Active.md");
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        app: {
          workspace: {
            getActiveFile: jest.fn(() => activeFile),
          },
        },
      } as unknown as CopilotPlugin;
      const publish = jest.fn().mockResolvedValue(undefined);

      registerCommands(plugin, publish);

      const command = commands.find(({ id }) => id === COMMAND_IDS.PUBLISH_FILE_TO_OPENARTIFACTS);
      expect(COMMAND_IDS.PUBLISH_FILE_TO_OPENARTIFACTS).toBe("publish-file-to-symposium");
      expect(command).toMatchObject({
        name: COMMAND_NAMES[COMMAND_IDS.PUBLISH_FILE_TO_OPENARTIFACTS],
        icon: COMMAND_ICONS[COMMAND_IDS.PUBLISH_FILE_TO_OPENARTIFACTS],
      });
      expect(command?.checkCallback?.(true)).toBe(true);
      expect(publish).not.toHaveBeenCalled();

      expect(command?.checkCallback?.(false)).toBe(true);
      expect(publish).toHaveBeenCalledWith(activeFile);
    });

    it.each([
      ["no active file", null],
      ["a non-Markdown active file", markdownFile("Notes/Diagram.canvas")],
    ])("hides the OpenArtifacts palette command for %s", (_case, activeFile) => {
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        app: {
          workspace: {
            getActiveFile: jest.fn(() => activeFile),
          },
        },
      } as unknown as CopilotPlugin;
      const publish = jest.fn().mockResolvedValue(undefined);

      registerCommands(plugin, publish);

      const command = commands.find(({ id }) => id === COMMAND_IDS.PUBLISH_FILE_TO_OPENARTIFACTS);
      expect(command?.checkCallback?.(true)).toBe(false);
      expect(command?.checkCallback?.(false)).toBe(false);
      expect(publish).not.toHaveBeenCalled();
    });

    it("registers no index command when Miyo is disabled (https://github.com/Brevilabs/obsidian-copilot-private/issues/282)", () => {
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        app: { workspace: { getActiveFile: jest.fn(() => null) } },
      } as unknown as CopilotPlugin;

      registerCommands(plugin, jest.fn());

      expect(commands.filter(({ id }) => id.includes("index"))).toEqual([]);
    });

    it("registers exactly one Miyo refresh command and starts a folder scan (https://github.com/Brevilabs/obsidian-copilot-private/issues/282)", async () => {
      jest.mocked(getSettings).mockReturnValue({
        enableMiyo: true,
        miyoServerUrl: "http://miyo.local",
        plusLicenseKey: "license",
      } as ReturnType<typeof getSettings>);
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        app: { workspace: { getActiveFile: jest.fn(() => null) } },
      } as unknown as CopilotPlugin;

      registerCommands(plugin, jest.fn());
      const indexCommands = commands.filter(({ id }) => id.includes("index"));
      expect(indexCommands).toHaveLength(1);
      expect(indexCommands[0]).toMatchObject({
        id: COMMAND_IDS.REFRESH_MIYO_INDEX,
        name: "Refresh Miyo index",
        icon: "refresh-cw",
      });

      indexCommands[0].callback?.();

      await waitFor(() =>
        expect(mockScanFolder).toHaveBeenCalledWith("http://127.0.0.1:8742", "Test Vault", false)
      );
      expect(Notice).toHaveBeenCalledWith(
        "Miyo vault scan started. Open Miyo to check indexing progress."
      );
    });

    it("requires a remote Miyo connection before refreshing on mobile (https://github.com/Brevilabs/obsidian-copilot-private/issues/282)", async () => {
      jest.mocked(getSettings).mockReturnValue({
        enableMiyo: true,
        miyoServerUrl: "",
      } as ReturnType<typeof getSettings>);
      jest.mocked(isDesktopRuntime).mockReturnValue(false);
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        app: { workspace: { getActiveFile: jest.fn(() => null) } },
      } as unknown as CopilotPlugin;

      registerCommands(plugin, jest.fn());
      commands.find(({ id }) => id === COMMAND_IDS.REFRESH_MIYO_INDEX)?.callback?.();

      await waitFor(() =>
        expect(Notice).toHaveBeenCalledWith("A remote Miyo connection is required on mobile.")
      );
      expect(mockResolveBaseUrl).not.toHaveBeenCalled();
      expect(mockScanFolder).not.toHaveBeenCalled();
    });

    it("refuses to scan after Miyo is disconnected while the palette entry survives (https://github.com/logancyang/obsidian-copilot/pull/3091#discussion_r3926747283)", async () => {
      jest.mocked(getSettings).mockReturnValue({
        enableMiyo: true,
        miyoServerUrl: "http://miyo.local",
      } as ReturnType<typeof getSettings>);
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        app: { workspace: { getActiveFile: jest.fn(() => null) } },
      } as unknown as CopilotPlugin;

      registerCommands(plugin, jest.fn());
      jest.mocked(getSettings).mockReturnValue({
        enableMiyo: false,
        miyoServerUrl: "http://miyo.local",
      } as ReturnType<typeof getSettings>);
      commands.find(({ id }) => id === COMMAND_IDS.REFRESH_MIYO_INDEX)?.callback?.();

      await waitFor(() =>
        expect(Notice).toHaveBeenCalledWith(
          "Miyo is disconnected. Connect it in Copilot settings, then retry."
        )
      );
      expect(mockResolveBaseUrl).not.toHaveBeenCalled();
      expect(mockScanFolder).not.toHaveBeenCalled();
    });

    it.each([
      [new Error("connection refused"), "Miyo is unavailable. Open Miyo, then retry the refresh."],
      [
        new MiyoRequestError(404, "folder not registered"),
        "This vault is not registered with Miyo. Register it in Miyo, then retry.",
      ],
    ])(
      "reports a failed Miyo refresh without silently succeeding (https://github.com/Brevilabs/obsidian-copilot-private/issues/282)",
      async (error, expectedNotice) => {
        jest.mocked(getSettings).mockReturnValue({
          enableMiyo: true,
          miyoServerUrl: "http://miyo.local",
        } as ReturnType<typeof getSettings>);
        mockScanFolder.mockRejectedValue(error);
        const commands: Command[] = [];
        const plugin = {
          addCommand: jest.fn((command: Command) => commands.push(command)),
          app: { workspace: { getActiveFile: jest.fn(() => null) } },
        } as unknown as CopilotPlugin;

        registerCommands(plugin, jest.fn());
        commands.find(({ id }) => id === COMMAND_IDS.REFRESH_MIYO_INDEX)?.callback?.();

        await waitFor(() => expect(Notice).toHaveBeenCalledWith(expectedNotice));
      }
    );
  });
});
