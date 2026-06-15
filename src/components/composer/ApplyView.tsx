import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { getSettings, updateSetting } from "@/settings/model";
import { ApplyViewResult } from "@/types";
import { ensureFolderExists } from "@/utils";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import React, { useMemo, useState } from "react";
import { Root } from "react-dom/client";
import { Button } from "../ui/button";
import { SettingSwitch } from "../ui/setting-switch";
import { analyzePatch } from "./diffHunks";
import { LineAcceptRejectRenderer } from "./LineAcceptRejectRenderer";

export const APPLY_VIEW_TYPE = "obsidian-copilot-apply-view";

/**
 * State passed when opening the Apply view. The view diffs `oldText` → `newText`
 * itself, so the exact on-disk and proposed texts round-trip without going
 * through a lossy Change[] representation.
 */
export interface ApplyViewState {
  /** Current on-disk content of the target file. */
  oldText: string;
  /** Proposed content to write. */
  newText: string;
  path: string;
  resultCallback?: (result: ApplyViewResult) => void;
}

/**
 * Apply view — opens in its own leaf when the composer/agent proposes edits
 * to a vault file. Renders the diff with @pierre/diffs and writes the
 * accepted version back to disk.
 */
export class ApplyView extends ItemView {
  private root: Root | null = null;
  private state: ApplyViewState | null = null;
  private result: ApplyViewResult | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return APPLY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Preview Changes";
  }

  async setState(state: ApplyViewState) {
    this.state = state;
    this.render();
  }

  async onOpen() {
    this.render();
  }

  async onClose() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this.state?.resultCallback?.(this.result ? this.result : "aborted");
  }

  private render() {
    if (!this.state) return;

    // The second child is the actual content of the view; the first is the title.
    const contentEl = this.containerEl.children[1] as HTMLElement;

    // Create the mount node and React root exactly once. Re-rendering (e.g. a
    // second setState) must reuse the existing root — emptying contentEl and
    // recreating the node on every render would leave the root attached to a
    // detached element, rendering into an orphan and blanking the visible pane.
    if (!this.root) {
      contentEl.empty();
      // Force the React root to fill the leaf — without this it collapses to
      // content height and the floating Accept/Reject bar scrolls off.
      const rootEl = contentEl.createDiv({
        cls: "tw-flex tw-h-full tw-min-h-0 tw-flex-col",
      });
      this.root = createPluginRoot(rootEl, this.app);
    }

    this.root.render(
      <ApplyViewRoot
        app={this.app}
        state={this.state}
        close={(result) => {
          this.result = result;
          this.leaf.detach();
        }}
      />
    );
  }
}

interface ApplyViewRootProps {
  app: App;
  state: ApplyViewState;
  close: (result: ApplyViewResult) => void;
}

const ApplyViewRoot: React.FC<ApplyViewRootProps> = ({ app, state, close }) => {
  // Preserve the existing user preference for split-vs-side-by-side so the
  // toggle's persistence works across sessions.
  const [viewMode, setViewMode] = useState<"side-by-side" | "split">(
    () => getSettings().diffViewMode ?? "split"
  );

  const handleViewModeChange = (mode: "side-by-side" | "split") => {
    setViewMode(mode);
    updateSetting("diffViewMode", mode);
  };

  // Diff the exact on-disk text against the proposal once. The visual diff and
  // the per-line decision list both derive from this single pass, and so do the
  // header counts below. Safe-default to "" so these hooks never dereference a
  // missing field on a restored leaf — the validity guard below renders the
  // error UI for genuinely invalid state.
  const path = state?.path ?? "";
  const oldText = state?.oldText ?? "";
  const newText = state?.newText ?? "";
  const { parsed, changes } = useMemo(
    () => analyzePatch(path, oldText, newText),
    [path, oldText, newText]
  );

  // +N / −M line counts for the header, taken from the actual changed lines.
  const { additions, removals } = useMemo(
    () => ({
      additions: changes.filter((c) => c.kind === "+").length,
      removals: changes.filter((c) => c.kind === "-").length,
    }),
    [changes]
  );

  // Defensive: a restored leaf can lack the text fields (state isn't serialized
  // with a callback). This guard runs after all hooks so hook order is stable.
  if (!state || typeof state.oldText !== "string" || typeof state.newText !== "string") {
    logError("Invalid state:", state);
    return (
      <div className="tw-flex tw-h-full tw-flex-col tw-items-center tw-justify-center">
        <div className="tw-text-error">Error: Invalid state - missing content</div>
        <Button onClick={() => close("failed")} className="tw-mt-4">
          Close
        </Button>
      </div>
    );
  }

  /** Resolve a vault file, creating folders as needed. */
  const getFile = async (file_path: string) => {
    const file = app.vault.getAbstractFileByPath(file_path);
    if (file) return file;
    if (file_path.includes("/")) {
      const folderPath = file_path.split("/").slice(0, -1).join("/");
      await ensureFolderExists(folderPath);
    }
    return await app.vault.create(file_path, "");
  };

  /** Write the accepted text verbatim to the target file. */
  const writeFullText = async (finalText: string) => {
    const file = await getFile(state.path);
    if (!file || !(file instanceof TFile)) {
      logError("Error in getting file", state.path);
      new Notice("Failed to create file");
      return false;
    }
    await app.vault.modify(file, finalText);
    new Notice("Changes applied successfully");
    return true;
  };

  const handleAccept = async (finalText: string) => {
    try {
      const ok = await writeFullText(finalText);
      if (!ok) {
        close("failed");
        return;
      }
      // "accepted" only when the full proposal landed. If the user rejected
      // some lines, the file was written but differs from what was proposed —
      // report "partial" so the agent doesn't assume the file matches `newText`.
      close(finalText === newText ? "accepted" : "partial");
    } catch (error) {
      logError("Error applying changes:", error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Error applying changes: ${message}`);
      close("failed");
    }
  };

  const handleReject = () => {
    close("rejected");
  };

  return (
    <div className="tw-relative tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
      <div className="tw-flex tw-flex-none tw-items-center tw-justify-between tw-gap-3 tw-px-3 tw-py-2 tw-bg-secondary/50">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
          <span className="tw-truncate tw-font-mono tw-text-xs tw-text-muted">{state.path}</span>
          <span className="tw-flex tw-flex-none tw-items-center tw-gap-1 tw-font-mono tw-text-xs">
            <span className="tw-text-success">+{additions}</span>
            <span className="tw-text-error">−{removals}</span>
          </span>
        </div>
        <div className="tw-flex tw-flex-none tw-items-center tw-gap-2">
          <span
            className={cn(
              "tw-text-xs",
              viewMode === "split" ? "tw-font-medium tw-text-normal" : "tw-text-muted"
            )}
          >
            Unified
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

      <LineAcceptRejectRenderer
        oldText={oldText}
        parsed={parsed}
        changes={changes}
        diffStyle={viewMode === "side-by-side" ? "split" : "unified"}
        onAccept={handleAccept}
        onReject={handleReject}
      />
    </div>
  );
};
