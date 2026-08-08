import {
  getCommandId,
  isCustomCommandFile,
  loadAllCustomCommands,
  fetchAllCustomCommands,
  parseCustomCommandFile,
  getNextCustomCommandOrder,
  ensureCommandFrontmatter,
  hasOrderFrontmatter,
} from "@/commands/customCommandUtils";
import { App, Editor, Plugin, TFile, Vault } from "obsidian";
import { CustomCommandChatModal } from "@/commands/CustomCommandChatModal";
import { debounce } from "@/utils/debounce";
import { CustomCommand } from "@/commands/type";
import {
  deleteCachedCommand,
  getCachedCustomCommands,
  isFileWritePending,
  updateCachedCommand,
  updateCachedCommands,
} from "@/commands/state";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { deriveCustomPromptsFolder } from "@/settings/copilotFolder";
import { logError } from "@/logger";

/** This manager is used to register custom commands as obsidian commands */
export class CustomCommandRegister {
  private plugin: Plugin;
  private app: App;
  private vault: Vault;
  private settingsUnsubscriber?: () => void;
  /** Monotonic request id for latest-wins semantics on folder change. */
  private folderChangeRequestId = 0;
  /** Set once {@link cleanup} runs so an in-flight reload cannot touch a torn-down instance. */
  private disposed = false;

  constructor(plugin: Plugin, app: App) {
    this.plugin = plugin;
    this.app = app;
    this.vault = app.vault;
    this.initializeEventListeners();
  }

  async initialize() {
    await loadAllCustomCommands(this.app);
    this.registerCommands();
  }

  /**
   * Register all custom commands found in the custom commands folder.
   * Synchronous: iterates cached commands and registers each.
   */
  private registerCommands() {
    const commands = getCachedCustomCommands();
    commands.forEach((command) => {
      this.registerCommand(command);
    });
  }

  /**
   * Clean up resources used by the cache
   */
  cleanup() {
    // Reason: mark disposed and bump the request id so any reload awaiting a
    // fetch bails out before it can register commands or write the module-level
    // cache after teardown.
    this.disposed = true;
    ++this.folderChangeRequestId;
    this.settingsUnsubscriber?.();
    this.vault.off("create", this.handleFileCreation);
    this.vault.off("delete", this.handleFileDeletion);
    this.vault.off("rename", this.handleFileRename);
    this.vault.off("modify", this.handleFileModify);
  }

  private initializeEventListeners() {
    this.vault.on("create", this.handleFileCreation);
    this.vault.on("delete", this.handleFileDeletion);
    this.vault.on("rename", this.handleFileRename);
    this.vault.on("modify", this.handleFileModify);
    this.settingsUnsubscriber = subscribeToSettingsChange(this.handleSettingsChange);
  }

  /**
   * React to a change in the derived custom-commands folder (driven by the
   * configurable copilotFolder root). Reloads command registrations from the
   * new folder while old files stay in place.
   */
  private handleSettingsChange = (
    prev: ReturnType<typeof getSettings>,
    next: ReturnType<typeof getSettings>
  ): void => {
    // Reason: the folder is derived from copilotFolder; compare derived paths.
    if (deriveCustomPromptsFolder(prev) !== deriveCustomPromptsFolder(next)) {
      // Started immediately, not debounced: the root is committed through an
      // explicit Apply + Confirm, so there is no keystroke burst to absorb, and
      // every millisecond of delay is a millisecond in which a caller holding a
      // command from the old folder can write it through the new one.
      void this.handleFolderChange();
    }
  };

  /**
   * Reload command registrations after the folder changes, using a pure fetch
   * followed by an atomic swap so a superseded reload cannot register commands
   * from a stale folder or clobber a newer cache.
   *
   * Reason: `loadAllCustomCommands` writes the global cache before returning, so
   * an in-flight stale reload would pollute the cache even behind a request-id
   * guard. Fetching without touching the cache, then checking the generation
   * before mutating registrations, keeps only the latest reload's effect.
   *
   * DESIGN NOTE (scan-race, accepted): if a `handleFileCreation` registers a new
   * command file and writes the cache while this fetch is in flight, the fetch
   * snapshot predates that command, so the atomic-swap phase treats it as stale,
   * removes its registration, and `updateCachedCommands` overwrites it out of the
   * cache.
   * (a) Trigger: a command file created concurrently inside the root-change
   *     fetch window.
   * (b) Consequence: that command is briefly cleared by this swap; the next vault
   *     event targeting the same file (modify/create/delete) re-registers it, so
   *     the state self-heals.
   * (c) Why not fixed: a real fix needs a vault-mutation generation counter; that
   *     machinery is disproportionate to a window that is both narrow (root change
   *     overlapping a concurrent command-file create) and self-healing.
   * (d) If a future review flags this again, point them at this note.
   */
  private async handleFolderChange(): Promise<void> {
    const currentRequestId = ++this.folderChangeRequestId;

    try {
      const nextCommands = await fetchAllCustomCommands(this.app);

      // Bail out if the instance was torn down while this fetch was in flight;
      // registering commands or writing the cache post-teardown would leak state.
      if (this.disposed) return;

      // Latest-wins: a newer folder change started while this fetch was in flight.
      if (currentRequestId !== this.folderChangeRequestId) return;

      // Atomically swap registrations: drop commands no longer present, then
      // (re)register the current set, then replace the cache in one step.
      const nextTitles = new Set(nextCommands.map((command) => command.title));
      for (const stale of getCachedCustomCommands()) {
        if (!nextTitles.has(stale.title)) {
          this.removeRegisteredCommand(stale.title);
        }
      }
      nextCommands.forEach((command) => this.registerCommand(command));
      updateCachedCommands(nextCommands);
    } catch (error) {
      // Latest-wins guard: ignore a stale failure resolved after a newer reload.
      if (currentRequestId !== this.folderChangeRequestId) return;
      logError("Error reloading custom commands after folder change", error);
    }
  }

  /** Remove a registered obsidian command by its command title. */
  private removeRegisteredCommand(title: string): void {
    const commandId = getCommandId(title);
    (this.plugin as unknown as { removeCommand: (id: string) => void }).removeCommand(commandId);
  }

  private handleFileModify = debounce(
    async (file: TFile) => {
      if (!isCustomCommandFile(file) || isFileWritePending(file.path)) {
        return;
      }
      const customCommand = await parseCustomCommandFile(this.app, file);
      this.registerCommand(customCommand);
      updateCachedCommand(customCommand, customCommand.title);
    },
    1000,
    {
      // We cannot use leading: true because frontmatter is not updated
      // immediately when modify event is triggered.
      leading: false,
      trailing: true,
    }
  );

  // Note: This function is called when obsidian starts up.
  private handleFileCreation = async (file: TFile) => {
    if (!isCustomCommandFile(file) || isFileWritePending(file.path)) {
      return;
    }
    try {
      let customCommand = await parseCustomCommandFile(this.app, file);
      if (!hasOrderFrontmatter(this.app, file)) {
        // Compute the correct order for the new command
        const newOrder = getNextCustomCommandOrder();
        customCommand = { ...customCommand, order: newOrder };
      }
      await ensureCommandFrontmatter(this.app, file, customCommand);
      updateCachedCommand(customCommand, customCommand.title);
      this.registerCommand(customCommand);
    } catch (error) {
      logError(`Error processing custom command creation: ${file.path}`, error);
    }
  };

  private handleFileDeletion = async (file: TFile) => {
    if (!isCustomCommandFile(file) || isFileWritePending(file.path)) {
      return;
    }
    const commandId = getCommandId(file.basename);
    (this.plugin as unknown as { removeCommand: (id: string) => void }).removeCommand(commandId);
    deleteCachedCommand(file.basename);
  };

  private handleFileRename = async (file: TFile, oldPath: string) => {
    if (isFileWritePending(file.path)) {
      return;
    }
    // Remove the old command
    const oldFilename = oldPath.split("/").pop()?.replace(/\.md$/, "");
    if (oldFilename) {
      const oldCommandId = getCommandId(oldFilename);
      (this.plugin as unknown as { removeCommand: (id: string) => void }).removeCommand(
        oldCommandId
      );
      deleteCachedCommand(oldFilename);
    }
    // Register the new command if it's still a custom command file
    if (isCustomCommandFile(file)) {
      const parsedCommand = await parseCustomCommandFile(this.app, file);
      this.registerCommand(parsedCommand);
      updateCachedCommand(parsedCommand, parsedCommand.title);
      await ensureCommandFrontmatter(this.app, file, parsedCommand);
    }
  };

  private registerCommand(customCommand: CustomCommand) {
    const commandId = getCommandId(customCommand.title);
    (this.plugin as unknown as { removeCommand: (id: string) => void }).removeCommand(commandId);
    this.plugin.addCommand({
      id: commandId,
      name: customCommand.title,
      editorCallback: (editor: Editor) => {
        new CustomCommandChatModal(this.plugin.app, {
          selectedText: editor.getSelection(),
          command: customCommand,
        }).open();
        void CustomCommandManager.getInstance()
          .recordUsage(customCommand)
          .catch((err) => logError("recordUsage failed", err));
      },
    });
  }
}
