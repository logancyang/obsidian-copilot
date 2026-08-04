import type { Meta, StoryObj } from "@/lib/story";
import { cn } from "@/lib/utils";
import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import { ItemView, Plugin, type WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { modules, presentationalComponentCount } from "./stories.generated";

export const GALLERY_VIEWTYPE = "copilot-component-gallery";

interface StoryModule extends Record<string, unknown> {
  default: Meta<Record<string, unknown>>;
}

interface LoadedStoryModule {
  componentId: string | null;
  storyModule: StoryModule;
}

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
    const storyModules = await Promise.all(
      modules.map(async ({ componentId, load }) => ({
        componentId,
        storyModule: (await load()) as StoryModule,
      }))
    );
    this.viewRoot = mountPluginViewRoot(this.containerEl, this.app, () =>
      this.renderTree(storyModules)
    );
  }

  private renderTree(storyModules: LoadedStoryModule[]): React.ReactNode {
    const coveredComponentIds = new Set<string>();
    const optedOutComponentIds = new Set<string>();

    for (const { componentId, storyModule } of storyModules) {
      if (!componentId) {
        continue;
      }

      if (storyModule.default.parameters?.gallery?.coverage === false) {
        optedOutComponentIds.add(componentId);
      } else if (Object.keys(storyModule).some((exportName) => exportName !== "default")) {
        coveredComponentIds.add(componentId);
      }
    }

    const componentCount = presentationalComponentCount - optedOutComponentIds.size;
    const coveredCount = coveredComponentIds.size;

    return React.createElement(
      "div",
      { className: cn("tw-flex tw-flex-col tw-gap-4 tw-p-4") },
      React.createElement(
        "p",
        { "data-gallery-coverage-summary": true },
        `${componentCount} presentational components · ${coveredCount} with stories · ${componentCount - coveredCount} missing`
      ),
      storyModules.map(({ storyModule: mod }) => {
        const meta = mod.default;
        const displayTitle = meta.title.split("/").join(" / ");
        const stories = Object.entries(mod).filter(([exportName]) => exportName !== "default");

        return React.createElement(
          "section",
          {
            "aria-label": `${displayTitle} stories`,
            className: cn("tw-flex tw-flex-col tw-gap-3 tw-rounded-md tw-border tw-p-4"),
            key: meta.title,
          },
          React.createElement(
            "header",
            { className: cn("tw-flex tw-items-center tw-justify-between tw-gap-2") },
            React.createElement("h2", null, displayTitle),
            React.createElement(
              "span",
              null,
              `${stories.length} ${stories.length === 1 ? "story" : "stories"}`
            )
          ),
          stories.map(([exportName, value]) => {
            const story = value as StoryObj<Record<string, unknown>>;
            const args = { ...meta.args, ...story.args };
            const gallery = { ...meta.parameters?.gallery, ...story.parameters?.gallery };
            const storyId = `${meta.title}/${exportName}`;
            const displayName = story.name ?? exportName;
            let node: React.ReactNode;

            if (story.render) {
              node = React.createElement(story.render, args);
            } else if (meta.component) {
              node = React.createElement(meta.component, args);
            } else {
              throw new Error(`Story "${storyId}" must define render or meta.component`);
            }

            return React.createElement(
              "section",
              {
                "aria-label": `${displayName} story`,
                "data-gallery-coverage": gallery.coverage,
                "data-gallery-host": gallery.host,
                "data-gallery-layout": gallery.layout,
                "data-gallery-width": gallery.width,
                className: cn("tw-flex tw-flex-col tw-gap-2"),
                key: storyId,
              },
              React.createElement("h3", null, displayName),
              node
            );
          })
        );
      })
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
