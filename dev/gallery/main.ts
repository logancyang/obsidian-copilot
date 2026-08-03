import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import { ItemView, Plugin, type WorkspaceLeaf } from "obsidian";
import * as React from "react";

export const GALLERY_VIEWTYPE = "copilot-component-gallery";

const BUTTON_VARIANTS = [
  "default",
  "destructive",
  "secondary",
  "ghost",
  "link",
  "success",
  "ghost2",
] as const;
const BUTTON_SIZES = ["default", "sm", "lg", "icon", "fit"] as const;

class GalleryView extends ItemView {
  private viewRoot: PluginViewRootHandle | null = null;

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
    this.viewRoot = mountPluginViewRoot(this.containerEl, this.app, () => this.renderTree());
  }

  private renderTree(): React.ReactNode {
    return React.createElement(
      "div",
      { className: cn("tw-flex tw-flex-col tw-gap-4 tw-p-4") },
      BUTTON_VARIANTS.map((variant) =>
        React.createElement(
          "section",
          {
            "aria-label": `${variant} Button variant`,
            className: cn("tw-flex tw-flex-wrap tw-items-center tw-gap-2"),
            key: variant,
          },
          React.createElement("span", null, variant),
          BUTTON_SIZES.map((size) =>
            React.createElement(Button, { key: size, size, variant }, size)
          )
        )
      )
    );
  }

  async onClose(): Promise<void> {
    this.viewRoot?.unmount();
    this.viewRoot = null;
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
