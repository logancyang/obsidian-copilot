import { buildTurnFileChange } from "@/agentMode/session/turnFileChanges";
import type { TurnFileChange } from "@/agentMode/session/types";
import {
  ChangeScroller,
  useChangeNavigation,
  type ChangeStep,
} from "@/agentMode/ui/renderedDiff/ChangeScroller";
import { markedSelectionText } from "@/agentMode/ui/renderedDiff/markedSelection";
import type { DiffRun } from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { RenderedDiff } from "@/agentMode/ui/renderedDiff/RenderedDiff";
import { revokeRun } from "@/agentMode/ui/renderedDiff/revokeRun";
import { TurnDiffHeader } from "@/agentMode/ui/TurnDiffHeader";
import { COMMAND_IDS, COMMAND_NAMES, TURN_DIFF_VIEW_TYPE } from "@/constants";
import { useApp } from "@/context";
import { logError } from "@/logger";
import type { SelectionReport } from "@/selection/selectionStore";
import { openFileInTab, type OpenPane } from "@/utils/openVaultPath";
import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import {
  App,
  ItemView,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";
import React, { type ReactNode } from "react";
import { v4 as uuidv4 } from "uuid";

// A diff tab's capture lives only in memory, so tabs restored after a restart or plugin reload are empty.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
export function closeRestoredTurnDiffs(workspace: Workspace): void {
  workspace.onLayoutReady(() => workspace.detachLeavesOfType(TURN_DIFF_VIEW_TYPE));
}

export function registerTurnDiffCommands(plugin: Plugin): void {
  const steps = [
    [COMMAND_IDS.NEXT_DIFF_CHANGE, 1],
    [COMMAND_IDS.PREVIOUS_DIFF_CHANGE, -1],
  ] as const;
  for (const [id, direction] of steps) {
    plugin.addCommand({
      id,
      name: COMMAND_NAMES[id],
      repeatable: true,
      checkCallback: (checking) =>
        plugin.app.workspace.getActiveViewOfType(TurnDiffView)?.stepChange(direction, checking) ??
        false,
    });
  }
}

export interface TurnDiffViewState extends TurnFileChange {
  turnId: string;
}

export class TurnDiffView extends ItemView {
  private viewRoot: PluginViewRootHandle | null = null;
  private state: TurnDiffViewState | null = null;
  private stepper: ((direction: ChangeStep) => void) | null = null;
  private revoking = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  static activeSelection(this: void, app: App): (() => SelectionReport) | null {
    const view = app.workspace.getActiveViewOfType(TurnDiffView);
    const state = view?.state;
    if (!view || !state) return null;
    const location = turnDiffKey(state.turnId, state.path);
    return () => {
      const selection = view.containerEl.ownerDocument.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const inView = range && view.containerEl.contains(range.commonAncestorContainer);
      const content = inView ? markedSelectionText(range) : "";
      if (!content) return { location, context: null };
      return {
        location,
        key: `${location}\n${content}`,
        context: {
          id: uuidv4(),
          content,
          sourceType: "note",
          noteTitle: basename(state.path).replace(/\.[^.]+$/, ""),
          notePath: state.path,
          startLine: 0,
          endLine: 0,
        },
      };
    };
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

  stepChange(direction: ChangeStep, checking: boolean): boolean {
    if (!this.stepper) return false;
    if (!checking) this.stepper(direction);
    return true;
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

  private readonly setStepper = (stepper: ((direction: ChangeStep) => void) | null): void => {
    this.stepper = stepper;
  };

  // The tab keeps its own copy of the turn's result, so a revoked run reads as unchanged until the
  // tab closes. A click from a render older than the current state carries stale line ranges.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/823
  private readonly revoke = async (state: TurnDiffViewState, run: DiffRun): Promise<void> => {
    const file = this.app.vault.getAbstractFileByPath(state.path);
    const { before, after } = state;
    if (this.revoking || state !== this.state || !(file instanceof TFile)) return;
    if (before === null || after === null) return;
    this.revoking = true;
    let revokedAfter: string | null = null;
    try {
      await this.app.vault.process(file, (current) => {
        const revoked = revokeRun(before, after, current, run);
        revokedAfter = revoked?.after ?? null;
        return revoked?.current ?? current;
      });
    } finally {
      this.revoking = false;
    }
    if (revokedAfter === null) {
      new Notice("This text changed in the note after the turn, so it was not revoked.");
      return;
    }
    const counts = buildTurnFileChange(state.path, before, revokedAfter);
    this.state = {
      ...state,
      after: revokedAfter,
      additions: counts?.additions ?? 0,
      deletions: counts?.deletions ?? 0,
    };
    this.viewRoot?.rerender();
  };

  private renderTree(): ReactNode {
    return this.state ? (
      <TurnDiffPane state={this.state} onStepperChange={this.setStepper} onRevoke={this.revoke} />
    ) : null;
  }
}

interface TurnDiffPaneProps {
  state: TurnDiffViewState;
  onStepperChange: (stepper: ((direction: ChangeStep) => void) | null) => void;
  onRevoke: (state: TurnDiffViewState, run: DiffRun) => Promise<void>;
}

const TurnDiffPane: React.FC<TurnDiffPaneProps> = ({ state, onStepperChange, onRevoke }) => {
  const app = useApp();
  const navigation = useChangeNavigation();
  const current = useNoteText(app, state.path);
  const total = navigation.layout.ticks.length;
  React.useEffect(() => {
    onStepperChange(total > 0 ? navigation.step : null);
  }, [onStepperChange, navigation.step, total]);
  return (
    <div className="tw-flex tw-h-full tw-flex-col">
      <TurnDiffHeader
        path={state.path}
        status={state.status}
        additions={state.additions}
        deletions={state.deletions}
        changes={{ current: navigation.current, total, onStep: navigation.step }}
        onOpenNote={
          state.status === "deleted" ? undefined : (pane) => openNote(app, state.path, pane)
        }
      />
      <ChangeScroller navigation={navigation}>
        <RenderedDiff
          before={state.before}
          after={state.after}
          path={state.path}
          revoke={
            state.status === "modified" && current !== undefined
              ? {
                  current,
                  onRevoke: (run) =>
                    void onRevoke(state, run).catch((error: unknown) =>
                      logError("[TurnDiffView] failed to revoke a change", error)
                    ),
                }
              : undefined
          }
        />
      </ChangeScroller>
    </div>
  );
};

// Revoke compares each run with the note as it is now, so the tab follows the note while it is open.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/823
function useNoteText(app: App, path: string): string | null | undefined {
  const [text, setText] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    let latest = 0;
    const load = (): void => {
      const read = ++latest;
      const file = app.vault.getAbstractFileByPath(path);
      const content = file instanceof TFile ? app.vault.cachedRead(file) : Promise.resolve(null);
      void content.then(
        (value) => {
          if (read === latest) setText(value);
        },
        (error: unknown) => logError("[TurnDiffView] failed to read the note", error)
      );
    };
    const onChange = (file: TAbstractFile, oldPath?: string): void => {
      if (file.path === path || oldPath === path) load();
    };
    const refs = [
      app.vault.on("modify", onChange),
      app.vault.on("create", onChange),
      app.vault.on("delete", onChange),
      app.vault.on("rename", onChange),
    ];
    load();
    return () => {
      latest = -1;
      for (const ref of refs) app.vault.offref(ref);
    };
  }, [app, path]);
  return text;
}

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

function openNote(app: App, path: string, pane: OpenPane): void {
  const file = app.vault.getAbstractFileByPath(path);
  // Opening a path whose file was renamed or deleted after the turn would create an empty note.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  if (!(file instanceof TFile)) {
    new Notice(`${path} no longer exists.`);
    return;
  }
  void openFileInTab(app, file, pane).catch((error: unknown) =>
    logError("[TurnDiffView] failed to open the note", error)
  );
}

function basename(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? path : path.slice(separator + 1);
}
