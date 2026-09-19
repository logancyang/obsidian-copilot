import type { TurnFileChange } from "@/agentMode/session/types";
import { RenderedDiff } from "@/agentMode/ui/renderedDiff";
import { TurnDiffHeader } from "@/agentMode/ui/TurnDiffHeader";
import { useApp } from "@/context";
import { openVaultPath } from "@/utils/openVaultPath";
import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import { App, ItemView, WorkspaceLeaf } from "obsidian";
import React, { type ReactNode } from "react";

export const TURN_DIFF_VIEW_TYPE = "copilot-turn-diff-view";

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
    // Obsidian calls setState with an empty object while rehydrating a workspace; that
    // must not blank a tab already showing a diff. https://github.com/Brevilabs/obsidian-copilot-private/issues/348
    if (!state?.path) return;
    this.state = state;
    this.refreshTitle();
    this.viewRoot?.rerender();
  }

  private refreshTitle(): void {
    const { titleEl } = this as unknown as { titleEl?: HTMLElement };
    titleEl?.setText(this.getDisplayText());
  }

  // The captured before/after is session-scoped, so publishing state would restore a
  // tab that can never show its content again. https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  getState(): Record<string, unknown> {
    return {};
  }

  async onOpen(): Promise<void> {
    this.viewRoot = mountPluginViewRoot(this.containerEl, this.app, () => this.renderTree());
    // A plugin reload rebuilds this leaf with no state; close it instead of leaving an
    // empty tab. A tab being opened for real has its state by the time this runs. https://github.com/Brevilabs/obsidian-copilot-private/issues/348
    const win = this.containerEl.win;
    const pending = win.setTimeout(() => {
      if (!this.state) this.leaf.detach();
    }, 0);
    this.register(() => win.clearTimeout(pending));
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
        onOpenNote={
          state.status === "deleted"
            ? undefined
            : () => openVaultPath(app, state.path, { newLeaf: true })
        }
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
    .find((leaf) => readDiffKey(leaf.view) === key);
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

function readDiffKey(view: unknown): string | undefined {
  const maybeView = view as { getDiffKey?: () => unknown };
  if (typeof maybeView?.getDiffKey !== "function") return undefined;
  const result = maybeView.getDiffKey();
  return typeof result === "string" ? result : undefined;
}

function basename(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? path : path.slice(separator + 1);
}
