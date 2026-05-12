import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { getSettings, updateSetting } from "@/settings/model";
import { Change } from "diff";
import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../ui/button";
import { SettingSwitch } from "../ui/setting-switch";
import { ApplyViewResult } from "@/types";
import { ensureFolderExists } from "@/utils";
import { PierreRenderer } from "./PierreRenderer";

export const APPLY_VIEW_TYPE = "obsidian-copilot-apply-view";

/** State passed when opening the Apply view. */
export interface ApplyViewState {
  changes: Change[];
  path: string;
  resultCallback?: (result: ApplyViewResult) => void;
}

/**
 * Apply view — opens in its own leaf when the composer/agent proposes edits
 * to a vault file. Renders the diff with @pierre/diffs and writes the
 * accepted version back to disk.
 */
export class ApplyView extends ItemView {
  private root: ReturnType<typeof createRoot> | null = null;
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
    const contentEl = this.containerEl.children[1];
    contentEl.empty();

    const rootEl = contentEl.createDiv();
    if (!this.root) {
      this.root = createRoot(rootEl);
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

  // Reconstruct original and proposed full text from the change list.
  const oldText = useMemo(
    () =>
      state.changes
        .filter((c) => !c.added)
        .map((c) => c.value)
        .join(""),
    [state.changes]
  );
  const newText = useMemo(
    () =>
      state.changes
        .filter((c) => !c.removed)
        .map((c) => c.value)
        .join(""),
    [state.changes]
  );

  // Defensive: state validity check.
  if (!state || !state.changes) {
    logError("Invalid state:", state);
    return (
      <div className="tw-flex tw-h-full tw-flex-col tw-items-center tw-justify-center">
        <div className="tw-text-error">Error: Invalid state - missing changes</div>
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
      close(ok ? "accepted" : "failed");
    } catch (error) {
      logError("Error applying changes:", error);
      new Notice(`Error applying changes: ${error.message}`);
      close("failed");
    }
  };

  const handleReject = () => {
    close("rejected");
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

      <PierreRenderer
        oldText={oldText}
        newText={newText}
        path={state.path}
        diffStyle={viewMode === "side-by-side" ? "split" : "unified"}
        onAccept={handleAccept}
        onReject={handleReject}
      />
    </div>
  );
};
