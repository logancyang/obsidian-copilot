import { logError } from "@/logger";
import { ItemView, type View, type WorkspaceLeaf } from "obsidian";

export const STARTUP_LOADING_TEXT = "Starting Copilot…";

export interface CopilotStartup {
  whenStarted(): Promise<void>;
  createStartedView(viewType: string, leaf: WorkspaceLeaf): View | undefined;
}

// A tab restored while Copilot starts in the background would otherwise read "Plugin no longer
// active", inviting users to close it. https://github.com/logancyang/obsidian-copilot/issues/3518
export class StartupLoadingView extends ItemView {
  private savedState: Record<string, unknown> = {};

  constructor(
    leaf: WorkspaceLeaf,
    private readonly viewType: string,
    private readonly startup: CopilotStartup
  ) {
    super(leaf);
  }

  getViewType(): string {
    return this.viewType;
  }

  getDisplayText(): string {
    return "Copilot";
  }

  getIcon(): string {
    return "message-square";
  }

  getState(): Record<string, unknown> {
    return this.savedState;
  }

  async setState(state: Record<string, unknown>): Promise<void> {
    this.savedState = state;
  }

  async onOpen(): Promise<void> {
    this.contentEl.createDiv({
      cls: "tw-flex tw-size-full tw-items-center tw-justify-center tw-text-muted",
      text: STARTUP_LOADING_TEXT,
    });
    void this.replaceOnceStarted().catch((error) => {
      logError("Copilot could not open a tab restored during startup.", error);
    });
  }

  private async replaceOnceStarted(): Promise<void> {
    await this.startup.whenStarted();
    // A tab closed or reused while Copilot starts, or a startup cut short by an unload, has no
    // view to restore. https://github.com/logancyang/obsidian-copilot/issues/3518
    if (this.leaf.view !== this) return;
    const view = this.startup.createStartedView(this.viewType, this.leaf);
    if (!view) return;
    await this.leaf.open(view);
    await view.setState(this.savedState, { history: false });
  }
}
