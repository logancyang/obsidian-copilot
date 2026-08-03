import { ItemView, Plugin, type WorkspaceLeaf } from "obsidian";

export const GALLERY_VIEWTYPE = "copilot-component-gallery";

class GalleryView extends ItemView {
  getViewType(): string {
    return GALLERY_VIEWTYPE;
  }

  getDisplayText(): string {
    return "Component gallery";
  }

  getIcon(): string {
    return "layout-grid";
  }

  async onOpen(): Promise<void> {
    this.contentEl.setText("Gallery: 0 stories");
  }
}

/**
 * Manages only the development component gallery view and its open command.
 * It does not load or alter the production Copilot runtime.
 */
export default class GalleryPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(GALLERY_VIEWTYPE, (leaf: WorkspaceLeaf) => new GalleryView(leaf));
    this.addCommand({
      id: "open-component-gallery",
      name: "Open component gallery",
      callback: async () => {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.setViewState({ type: GALLERY_VIEWTYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
      },
    });
  }
}
