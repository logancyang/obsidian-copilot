import { App, Plugin, Vault } from "obsidian";
import { CustomCommandRegister } from "@/commands/customCommandRegister";
import type { CustomCommand } from "@/commands/type";
import type { CopilotSettings } from "@/settings/model";

jest.mock("obsidian", () => ({
  Plugin: jest.fn(),
  Vault: jest.fn(),
  TFile: jest.fn(),
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/^\/|\/$/g, ""),
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
}));

jest.mock("@/commands/CustomCommandChatModal", () => ({
  CustomCommandChatModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

jest.mock("@/commands/customCommandManager", () => ({
  CustomCommandManager: {
    getInstance: jest.fn(() => ({ recordUsage: jest.fn().mockResolvedValue(undefined) })),
  },
}));

jest.mock("@/commands/customCommandUtils", () => ({
  getCommandId: (title: string) => `copilot-command-${title}`,
  isCustomCommandFile: jest.fn(() => true),
  loadAllCustomCommands: jest.fn().mockResolvedValue([]),
  fetchAllCustomCommands: jest.fn(),
  parseCustomCommandFile: jest.fn(),
  getNextCustomCommandOrder: jest.fn(() => 0),
  ensureCommandFrontmatter: jest.fn(),
  hasOrderFrontmatter: jest.fn(() => true),
}));

jest.mock("@/commands/state", () => ({
  deleteCachedCommand: jest.fn(),
  getCachedCustomCommands: jest.fn(() => []),
  isFileWritePending: jest.fn(() => false),
  updateCachedCommand: jest.fn(),
  updateCachedCommands: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ copilotFolder: "copilot" })),
  subscribeToSettingsChange: jest.fn().mockReturnValue(() => {}),
}));

function command(title: string): CustomCommand {
  return {
    title,
    content: "",
    modelKey: "",
    showInContextMenu: false,
    showInSlashMenu: false,
    order: 0,
    lastUsedMs: 0,
  };
}

function settingsWithRoot(copilotFolder: string): CopilotSettings {
  return { copilotFolder } as CopilotSettings;
}

describe("customCommandRegister", () => {
  describe("CustomCommandRegister", () => {
    describe("handleSettingsChange()", () => {
      let settingsChangeHandler: (prev: CopilotSettings, next: CopilotSettings) => void;
      let unsubscribe: jest.Mock;
      let addCommand: jest.Mock;
      let removeCommand: jest.Mock;
      let fetchAllCustomCommands: jest.Mock;
      let getCachedCustomCommands: jest.Mock;
      let updateCachedCommands: jest.Mock;

      beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        ({ fetchAllCustomCommands } = jest.requireMock("@/commands/customCommandUtils"));
        ({ getCachedCustomCommands, updateCachedCommands } = jest.requireMock("@/commands/state"));

        unsubscribe = jest.fn();
        const { subscribeToSettingsChange } = jest.requireMock<{
          subscribeToSettingsChange: jest.Mock;
        }>("@/settings/model");
        subscribeToSettingsChange.mockReturnValue(unsubscribe);

        addCommand = jest.fn();
        removeCommand = jest.fn();
        const mockPlugin = { addCommand, removeCommand, app: {} } as unknown as Plugin;
        const mockVault = { on: jest.fn(), off: jest.fn() } as unknown as Vault;

        new CustomCommandRegister(mockPlugin, { vault: mockVault } as unknown as App);

        settingsChangeHandler = subscribeToSettingsChange.mock
          .calls[0][0] as typeof settingsChangeHandler;
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it("reloads registrations when the derived folder changes because the root changed", async () => {
        getCachedCustomCommands.mockReturnValue([command("Old")]);
        fetchAllCustomCommands.mockResolvedValue([command("New")]);

        settingsChangeHandler(settingsWithRoot("copilot"), settingsWithRoot("team/ai"));
        await jest.advanceTimersByTimeAsync(0);

        // Stale "Old" registration removed, "New" registered, cache replaced.
        expect(removeCommand).toHaveBeenCalledWith("copilot-command-Old");
        expect(addCommand).toHaveBeenCalledWith(
          expect.objectContaining({ id: "copilot-command-New", name: "New" })
        );
        expect(updateCachedCommands).toHaveBeenCalledWith([command("New")]);
      });

      it("starts the reload without waiting, so no timer delay keeps old commands live", () => {
        // Any delay before the swap is a window in which a caller holding a
        // command from the old folder writes it through the new live root.
        fetchAllCustomCommands.mockResolvedValue([]);

        settingsChangeHandler(settingsWithRoot("copilot"), settingsWithRoot("team/ai"));

        expect(fetchAllCustomCommands).toHaveBeenCalledTimes(1);
      });

      it("does not reload when the root — and thus the derived folder — is unchanged", async () => {
        settingsChangeHandler(settingsWithRoot("copilot"), settingsWithRoot("copilot"));
        await jest.advanceTimersByTimeAsync(1000);

        expect(fetchAllCustomCommands).not.toHaveBeenCalled();
      });

      it("discards a superseded reload so its stale commands never reach the cache", async () => {
        let resolveStale: (value: CustomCommand[]) => void = () => {};
        const stalePromise = new Promise<CustomCommand[]>((r) => {
          resolveStale = r;
        });
        fetchAllCustomCommands
          .mockReturnValueOnce(stalePromise) // request A (stale)
          .mockResolvedValueOnce([command("Fresh")]); // request B (latest)

        // Request A: folder change copilot -> a
        settingsChangeHandler(settingsWithRoot("copilot"), settingsWithRoot("a"));
        await jest.advanceTimersByTimeAsync(0);

        // Request B: folder change a -> b, resolves before A
        settingsChangeHandler(settingsWithRoot("a"), settingsWithRoot("b"));
        await jest.advanceTimersByTimeAsync(0);

        expect(updateCachedCommands).toHaveBeenCalledWith([command("Fresh")]);
        updateCachedCommands.mockClear();

        // Now the stale request A resolves — it must be discarded.
        resolveStale([command("Stale")]);
        await Promise.resolve();
        await Promise.resolve();

        expect(updateCachedCommands).not.toHaveBeenCalled();
      });
    });

    describe("cleanup()", () => {
      it("unsubscribes from settings changes on teardown", () => {
        const unsubscribe = jest.fn();
        const { subscribeToSettingsChange } = jest.requireMock<{
          subscribeToSettingsChange: jest.Mock;
        }>("@/settings/model");
        subscribeToSettingsChange.mockReturnValue(unsubscribe);

        const mockPlugin = {
          addCommand: jest.fn(),
          removeCommand: jest.fn(),
          app: {},
        } as unknown as Plugin;
        const mockVault = { on: jest.fn(), off: jest.fn() } as unknown as Vault;
        const register = new CustomCommandRegister(mockPlugin, {
          vault: mockVault,
        } as unknown as App);

        register.cleanup();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
      });

      it("discards an in-flight reload that resolves after teardown so it never registers commands or writes the cache", async () => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        try {
          const { fetchAllCustomCommands } = jest.requireMock<{
            fetchAllCustomCommands: jest.Mock;
          }>("@/commands/customCommandUtils");
          const { getCachedCustomCommands, updateCachedCommands } = jest.requireMock<{
            getCachedCustomCommands: jest.Mock;
            updateCachedCommands: jest.Mock;
          }>("@/commands/state");
          getCachedCustomCommands.mockReturnValue([]);

          let resolveFetch: (value: CustomCommand[]) => void = () => {};
          fetchAllCustomCommands.mockReturnValue(
            new Promise<CustomCommand[]>((r) => {
              resolveFetch = r;
            })
          );

          const { subscribeToSettingsChange } = jest.requireMock<{
            subscribeToSettingsChange: jest.Mock;
          }>("@/settings/model");
          subscribeToSettingsChange.mockReturnValue(() => {});

          const addCommand = jest.fn();
          const removeCommand = jest.fn();
          const mockPlugin = { addCommand, removeCommand, app: {} } as unknown as Plugin;
          const mockVault = { on: jest.fn(), off: jest.fn() } as unknown as Vault;
          const register = new CustomCommandRegister(mockPlugin, {
            vault: mockVault,
          } as unknown as App);

          const settingsChangeHandler = subscribeToSettingsChange.mock.calls[0][0] as (
            prev: CopilotSettings,
            next: CopilotSettings
          ) => void;

          // Kick off a reload; its fetch stays pending across teardown.
          settingsChangeHandler(settingsWithRoot("copilot"), settingsWithRoot("team/ai"));
          await jest.advanceTimersByTimeAsync(0);

          register.cleanup();

          // The fetch resolves only after teardown; the disposed guard must drop it.
          resolveFetch([command("Late")]);
          await Promise.resolve();
          await Promise.resolve();

          expect(addCommand).not.toHaveBeenCalled();
          expect(updateCachedCommands).not.toHaveBeenCalled();
        } finally {
          jest.useRealTimers();
        }
      });
    });
  });
});
