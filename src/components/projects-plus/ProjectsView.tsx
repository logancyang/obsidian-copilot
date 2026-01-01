import { PROJECTS_PLUS_VIEWTYPE } from "@/constants";
import { AppContext } from "@/context";
import CopilotPlugin from "@/main";
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import ProjectsPanel from "./ProjectsPanel";

/**
 * ProjectsView - ItemView wrapper for the Projects+ panel
 *
 * Extends Obsidian's ItemView to integrate React components
 * for the Projects+ project management interface.
 */
export default class ProjectsView extends ItemView {
  private root: Root | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: CopilotPlugin
  ) {
    super(leaf);
  }

  getViewType(): string {
    return PROJECTS_PLUS_VIEWTYPE;
  }

  getIcon(): string {
    return "target";
  }

  getTitle(): string {
    return "Projects+";
  }

  getDisplayText(): string {
    return "Projects+";
  }

  async onOpen(): Promise<void> {
    this.root = createRoot(this.containerEl.children[1]);
    this.renderView();
  }

  private renderView(): void {
    if (!this.root) return;

    this.root.render(
      <AppContext.Provider value={this.app}>
        <ProjectsPanel plugin={this.plugin} />
      </AppContext.Provider>
    );
  }

  /**
   * Re-render the view (useful when data changes)
   */
  updateView(): void {
    this.renderView();
  }

  async onClose(): Promise<void> {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}
