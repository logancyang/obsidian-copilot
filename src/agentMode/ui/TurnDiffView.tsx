import type { TurnFileChange } from "@/agentMode/session/types";
import { FileChangeCounts, FileChangeStatusBadge } from "@/agentMode/ui/FileChangeSummary";
import { RenderedDiff } from "@/agentMode/ui/renderedDiff";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context";
import { openVaultPath } from "@/utils/openVaultPath";
import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import { App, ItemView, WorkspaceLeaf } from "obsidian";
import React, { type ReactNode } from "react";

export const TURN_DIFF_VIEW_TYPE = "copilot-turn-diff-view";

/**
 * One file's before and after, plus the turn it belongs to. Two turns that
 * touched the same file are two separate reviews, so the turn is part of the
 * tab's identity rather than a label on it.
 */
export interface TurnDiffViewState extends TurnFileChange {
  turnId: string;
}

/**
 * Read-only main-area tab that shows one file as the turn left it, with the
 * removed and added text marked up in place. The content is a snapshot handed
 * over at open time: the tab neither watches the vault nor writes to it, and it
 * is deliberately not restorable, because the capture lives only as long as the
 * chat session that produced it.
 */
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

  /** Which turn's file this tab already shows, so a repeat click can find it. */
  getDiffKey(): string | undefined {
    return this.state ? turnDiffKey(this.state.turnId, this.state.path) : undefined;
  }

  async setState(state: TurnDiffViewState): Promise<void> {
    // Obsidian calls setState with an empty object while rehydrating a
    // workspace. `getState` publishes nothing, so such a call carries no diff
    // and must not blank a tab that is already showing one.
    if (!state?.path) return;
    this.state = state;
    this.refreshTitle();
    this.viewRoot?.rerender();
  }

  /**
   * Obsidian reads the display text while it builds the view's chrome, which
   * happens before the state naming this tab arrives. The tab header catches up
   * by itself; the title inside the view header keeps the placeholder.
   */
  private refreshTitle(): void {
    const { titleEl } = this as unknown as { titleEl?: HTMLElement };
    titleEl?.setText(this.getDisplayText());
  }

  // The captured before/after is session-scoped and gone after a reload, so
  // publishing state would restore a tab that could never show its content
  // again. Obsidian drops a view whose state cannot be hydrated.
  getState(): Record<string, unknown> {
    return {};
  }

  async onOpen(): Promise<void> {
    this.viewRoot = mountPluginViewRoot(this.containerEl, this.app, () => this.renderTree());
    // Reloading the plugin rebuilds this leaf from the state above, which names
    // no file. The diff it once held cannot come back, so the tab closes rather
    // than lingering as an empty one. A tab that is genuinely being opened has
    // its state in hand by the time this runs.
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

  // Obsidian may open the view before or after handing it a state, so the tree
  // has to be renderable without one.
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
      {/* Both rows carry the reading view's own margins and line width, so the
          header sits directly above the text it describes. */}
      <div className="copilot-divider-b tw-px-[var(--file-margins)] tw-py-2">
        <div className="tw-mx-auto tw-flex tw-max-w-[var(--file-line-width)] tw-items-center tw-gap-2">
          <span
            title={state.path}
            className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm tw-text-muted"
          >
            {state.path}
          </span>
          <FileChangeCounts additions={state.additions} deletions={state.deletions} />
          <FileChangeStatusBadge status={state.status} />
          {/* A deleted file has nothing left to open, and routing its path
              through the vault would offer to create a note in its place. */}
          {state.status === "deleted" ? null : (
            <Button
              variant="link"
              size="sm"
              // Preflight is off and Obsidian's theme-scoped `button` rules
              // outrank plain utilities, so the fill, the border, the chrome
              // and the text color all need `!` for this to read as a link.
              className="!tw-h-auto tw-shrink-0 !tw-border-0 !tw-bg-transparent !tw-px-0 !tw-text-accent !tw-shadow-none"
              onClick={() => openVaultPath(app, state.path, { newLeaf: true })}
            >
              Open note
            </Button>
          )}
        </div>
      </div>
      <div className="tw-flex-1 tw-overflow-y-auto tw-p-[var(--file-margins)]">
        <div className="markdown-rendered tw-mx-auto tw-max-w-[var(--file-line-width)]">
          <RenderedDiff before={state.before} after={state.after} path={state.path} />
        </div>
      </div>
    </div>
  );
};

/**
 * Open the diff for one file of one turn, revealing the tab that already shows
 * it rather than opening a second copy.
 *
 * @param app - Workspace the tab is opened in.
 * @param change - The captured before/after to render.
 * @param turnId - The assistant turn the change was captured from.
 */
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
  // A new main-area tab, not a sidebar pane: the diff is a document to read.
  const leaf = app.workspace.getLeaf(true);
  const state: TurnDiffViewState = { ...change, turnId };
  // Hand the state to `setViewState` so Obsidian's lifecycle invokes
  // `setState` exactly once with the real payload; a stateless open followed by
  // a manual `setState` renders once against a node the next render detaches.
  await leaf.setViewState({ type: TURN_DIFF_VIEW_TYPE, active: true, state });
  app.workspace.revealLeaf(leaf);
}

/** Newline separates the two parts because neither a turn id nor a path holds one. */
function turnDiffKey(turnId: string, path: string): string {
  return `${turnId}\n${path}`;
}

/**
 * A plugin reload can leave Obsidian holding a view object from the previous
 * lifecycle for this type. Treat one that cannot answer as non-matching instead
 * of assuming the current class's methods exist on it.
 */
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
