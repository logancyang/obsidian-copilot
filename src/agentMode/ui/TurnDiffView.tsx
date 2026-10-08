import type { TurnFileChange } from "@/agentMode/session/types";
import { RenderedDiff } from "@/agentMode/ui/renderedDiff/RenderedDiff";
import { TurnDiffHeader } from "@/agentMode/ui/TurnDiffHeader";
import { TURN_DIFF_VIEW_TYPE } from "@/constants";
import { useApp } from "@/context";
import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import { App, ItemView, Notice, TFile, Workspace, WorkspaceLeaf } from "obsidian";
import React, { type ReactNode } from "react";

// A diff tab's capture lives only in memory, so tabs restored after a restart or plugin reload are empty.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
export function closeRestoredTurnDiffs(workspace: Workspace): void {
  workspace.onLayoutReady(() => workspace.detachLeavesOfType(TURN_DIFF_VIEW_TYPE));
}

export interface TurnDiffViewState extends TurnFileChange {
  turnId: string;
}

export class TurnDiffView extends ItemView {
  private viewRoot: PluginViewRootHandle | null = null;
  private state: TurnDiffViewState | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return TURN_DIFF_VIEW_TYPE;
  }

  getIcon(): string {
    return "file-diff";
  }

  getDisplayText(): string {
    return this.state ? basename(this.state.path) : "File diff";
  }

  getDiffKey(): string | undefined {
    return this.state ? turnDiffKey(this.state.turnId, this.state.path) : undefined;
  }

  async setState(state: TurnDiffViewState): Promise<void> {
    // Obsidian rebuilds a tab with empty state after a plugin reload, and the in-memory capture is gone.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
    if (!state?.path) {
      this.leaf.detach();
      return;
    }
    this.state = state;
    this.refreshTitle();
    this.viewRoot?.rerender();
  }

  // Obsidian fills an ItemView's header title only on load, before `setViewState` delivers the state;
  // its later `updateHeader` refreshes the tab title alone.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  private refreshTitle(): void {
    const { titleEl } = this as unknown as { titleEl?: HTMLElement };
    titleEl?.setText(this.getDisplayText());
  }

  async onOpen(): Promise<void> {
    this.viewRoot = mountPluginViewRoot(this.containerEl, this.app, () => this.renderTree());
  }

  async onClose(): Promise<void> {
    this.viewRoot?.unmount();
    this.viewRoot = null;
  }

  private renderTree(): ReactNode {
    return this.state ? <TurnDiffPane state={this.state} /> : null;
  }
}

interface TurnDiffPaneProps {
  state: TurnDiffViewState;
}

const TurnDiffPane: React.FC<TurnDiffPaneProps> = ({ state }) => {
  const app = useApp();
  return (
    <div className="tw-flex tw-h-full tw-flex-col">
      <TurnDiffHeader
        path={state.path}
        status={state.status}
        additions={state.additions}
        deletions={state.deletions}
        onOpenNote={state.status === "deleted" ? undefined : () => openNote(app, state.path)}
      />
      <div className="tw-flex-1 tw-overflow-y-auto tw-p-[var(--file-margins)]">
        <div className="markdown-rendered tw-mx-auto tw-max-w-[var(--file-line-width)]">
          <RenderedDiff before={state.before} after={state.after} path={state.path} />
        </div>
      </div>
    </div>
  );
};

export async function openTurnDiff(
  app: App,
  change: TurnFileChange,
  turnId: string
): Promise<void> {
  const key = turnDiffKey(turnId, change.path);
  const existing = app.workspace
    .getLeavesOfType(TURN_DIFF_VIEW_TYPE)
    .find((leaf) => leaf.view instanceof TurnDiffView && leaf.view.getDiffKey() === key);
  if (existing) {
    app.workspace.revealLeaf(existing);
    return;
  }
  const leaf = app.workspace.getLeaf(true);
  const state: TurnDiffViewState = { ...change, turnId };
  // Pass state through `setViewState` so `setState` runs once with the real payload; a
  // stateless open plus a manual `setState` renders against a node the next render detaches.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  await leaf.setViewState({ type: TURN_DIFF_VIEW_TYPE, active: true, state });
  app.workspace.revealLeaf(leaf);
}

function turnDiffKey(turnId: string, path: string): string {
  return `${turnId}\n${path}`;
}

function openNote(app: App, path: string): void {
  const file = app.vault.getAbstractFileByPath(path);
  // Opening a path whose file was renamed or deleted after the turn would create an empty note.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  if (!(file instanceof TFile)) {
    new Notice(`${path} no longer exists.`);
    return;
  }
  void app.workspace.getLeaf(true).openFile(file);
}

function basename(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? path : path.slice(separator + 1);
}
