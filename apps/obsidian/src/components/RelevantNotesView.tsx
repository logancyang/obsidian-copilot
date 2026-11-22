import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { RELEVANT_NOTES_VIEWTYPE } from "@/constants";
import { EventTargetContext } from "@/context";
import CopilotPlugin from "@/main";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { registerActiveLeafChangeBridge } from "@/utils/registerActiveLeafChangeBridge";
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { Root } from "react-dom/client";

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

    registerActiveLeafChangeBridge(this, this.eventTarget);
  }

  private renderView(): void {
    if (!this.root) return;

    this.root.render(
      <EventTargetContext.Provider value={this.eventTarget}>
        <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
          <RelevantNotes onAddToChat={(note) => void this.plugin.addNoteToActiveChat(note)} />
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
