import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { EVENT_NAMES, RELEVANT_NOTES_VIEWTYPE } from "@/constants";
import { EventTargetContext } from "@/context";
import CopilotPlugin from "@/main";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { ItemView, MarkdownView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { Root } from "react-dom/client";

/**
 * Standalone pane for the Relevant Notes panel, isolated from the chat views.
 *
 * `RelevantNotes` reads the active file via `useActiveFile`, which seeds from
 * the current active file on mount and then updates on the `ACTIVE_LEAF_CHANGE`
 * event on this view's own `eventTarget`. The plugin's global handler dispatches
 * that event only to the legacy chat view, so this view feeds its own
 * `eventTarget` (mirroring that handler's condition) on subsequent leaf changes.
 */
export default class RelevantNotesView extends ItemView {
  private root: Root | null = null;
  eventTarget: EventTarget;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: CopilotPlugin
  ) {
    super(leaf);
    this.app = plugin.app;
    this.eventTarget = new EventTarget();
  }

  getViewType(): string {
    return RELEVANT_NOTES_VIEWTYPE;
  }

  getIcon(): string {
    return "files";
  }

  getTitle(): string {
    return "Copilot Relevant Notes";
  }

  getDisplayText(): string {
    return "Copilot Relevant Notes";
  }

  async onOpen(): Promise<void> {
    this.root = createPluginRoot(this.containerEl.children[1], this.app);
    this.renderView();

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView && leaf.view.file) {
          this.eventTarget.dispatchEvent(new CustomEvent(EVENT_NAMES.ACTIVE_LEAF_CHANGE));
        }
      })
    );
  }

  private renderView(): void {
    if (!this.root) return;

    this.root.render(
      <EventTargetContext.Provider value={this.eventTarget}>
        <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
          <RelevantNotes onAddToChat={(text) => void this.plugin.insertTextIntoActiveChat(text)} />
        </div>
      </EventTargetContext.Provider>
    );
  }

  async onClose(): Promise<void> {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}
