import { SideBySideBlock, SplitBlock } from "@/components/diff/DiffBlocks";
import { cn } from "@/lib/utils";
import { getChangeBlocks } from "@/composerUtils";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { getSettings, updateSetting } from "@/settings/model";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { diffTrimmedLines } from "diff";
import { App, ItemView, WorkspaceLeaf } from "obsidian";
import React, { useMemo, useState } from "react";

export const AGENT_DIFF_VIEW_TYPE = "copilot-agent-diff-view";

/**
 * State handed to the diff view via `setViewState`. The before/after text is
 * captured at the moment the agent's edit was surfaced — this view never
 * touches the vault, so it is a static snapshot rather than a live document.
 */
export interface AgentDiffViewState {
  path: string;
  oldText: string;
  newText: string;
}

/** Derive the file basename for the tab title; fall back to the raw path. */
function basename(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] || path;
}

/**
 * Read-only main-area tab that renders an agent edit's before/after using the
 * same split / side-by-side renderer as the composer's `ApplyView` (lifted
 * into `@/components/diff/DiffBlocks`). Unlike `ApplyView` there is no
 * accept/reject flow and no file writing — closing the tab simply discards the
 * rendered DOM.
 */
export class AgentDiffView extends ItemView {
  private root: ReturnType<typeof createPluginRoot> | null = null;
  private state: AgentDiffViewState | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return AGENT_DIFF_VIEW_TYPE;
  }

  getIcon(): string {
    return "diff";
  }

  getDisplayText(): string {
    return this.state ? `Diff: ${basename(this.state.path)}` : "Diff";
  }

  // Persist enough to identify a reusable tab by path (see openAgentDiffView).
  // The snapshot is serializable, so a workspace reload re-renders the same
  // static before/after — acceptable for a read-only preview.
  getState(): Record<string, unknown> {
    return this.state ? { ...this.state } : {};
  }

  async setState(state: AgentDiffViewState): Promise<void> {
    if (!state || state.path === undefined) return;
    this.state = state;
    this.render();
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  private render(): void {
    if (!this.state) return;

    // The second child is the content area; the first is the tab title.
    // Mirrors the convention used by ApplyView / Obsidian's built-ins.
    const contentEl = this.containerEl.children[1];
    // Create the React root exactly once and reuse it on subsequent renders
    // (setState re-fires render for leaf reuse). Re-emptying the container
    // would detach the node `this.root` is bound to, leaving React writing
    // into an orphaned DOM subtree.
    if (!this.root) {
      contentEl.empty();
      const rootEl = contentEl.createDiv();
      this.root = createPluginRoot(rootEl, this.app);
    }

    this.root.render(<AgentDiffViewRoot state={this.state} />);
  }
}

interface AgentDiffViewRootProps {
  state: AgentDiffViewState;
}

/**
 * Renders the before/after blocks read-only. Modeled on `ApplyViewRoot`'s
 * rendering minus the accept/reject/apply machinery.
 */
const AgentDiffViewRoot: React.FC<AgentDiffViewRootProps> = ({ state }) => {
  const changeBlocks = useMemo(() => {
    const changes = diffTrimmedLines(state.oldText, state.newText, {
      newlineIsToken: true,
    });
    return getChangeBlocks(changes);
  }, [state.oldText, state.newText]);

  // View mode with settings persistence, shared with ApplyView (fallback to
  // "split" for users with older settings).
  const [viewMode, setViewMode] = useState<"side-by-side" | "split">(
    () => getSettings().diffViewMode ?? "split"
  );

  const handleViewModeChange = (mode: "side-by-side" | "split") => {
    setViewMode(mode);
    updateSetting("diffViewMode", mode);
  };

  return (
    <div className="tw-relative tw-flex tw-h-full tw-flex-col">
      <div className="tw-flex tw-items-center tw-justify-between tw-border-b tw-border-solid tw-border-border tw-p-2">
        <div className="tw-text-sm tw-font-medium">{state.path}</div>
        <div className="tw-flex tw-items-center tw-gap-2">
          <span
            className={cn(
              "tw-text-xs",
              viewMode === "split" ? "tw-font-medium tw-text-normal" : "tw-text-muted"
            )}
          >
            Split
          </span>
          <SettingSwitch
            checked={viewMode === "side-by-side"}
            onCheckedChange={(checked) => handleViewModeChange(checked ? "side-by-side" : "split")}
          />
          <span
            className={cn(
              "tw-text-xs",
              viewMode === "side-by-side" ? "tw-font-medium tw-text-normal" : "tw-text-muted"
            )}
          >
            Side-by-side
          </span>
        </div>
      </div>

      <div className="tw-flex-1 tw-overflow-auto tw-p-2">
        {changeBlocks.map((block, blockIndex) => (
          <div
            // eslint-disable-next-line @eslint-react/no-array-index-key -- changeBlocks is computed once from the diff and not reordered
            key={blockIndex}
            className={cn("tw-mb-4 tw-overflow-hidden tw-rounded-md")}
          >
            {viewMode === "side-by-side" ? (
              <SideBySideBlock block={block} />
            ) : (
              <SplitBlock block={block} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Open (or reveal) a read-only diff tab for the given edit. Reuses an existing
 * diff tab already showing the same `path` so re-opening doesn't fan out
 * duplicate views; otherwise opens a new tab leaf.
 */
export function openAgentDiffView(app: App, state: AgentDiffViewState): void {
  const existing = app.workspace
    .getLeavesOfType(AGENT_DIFF_VIEW_TYPE)
    .find((leaf) => (leaf.view.getState() as Partial<AgentDiffViewState>).path === state.path);

  if (existing) {
    void (existing.view as AgentDiffView).setState(state);
    app.workspace.revealLeaf(existing);
    return;
  }

  const leaf = app.workspace.getLeaf(true);
  // Pass state through `setViewState` so Obsidian invokes `setState` once with
  // the real payload (mirrors PlanPreviewView / ApplyView open helpers).
  void leaf.setViewState({
    type: AGENT_DIFF_VIEW_TYPE,
    active: true,
    state,
  });
}
