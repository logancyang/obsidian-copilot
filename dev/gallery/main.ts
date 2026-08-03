import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import { ItemView, Plugin, type WorkspaceLeaf } from "obsidian";
import * as React from "react";
import {
  createGalleryCatalog,
  Gallery,
  type GalleryCatalog,
  type GalleryViewState,
  type LoadedStoryModule,
  resolveGalleryViewState,
} from "./Gallery";
import { modules, presentationalComponentCount } from "./stories.generated";

export const GALLERY_VIEWTYPE = "copilot-component-gallery";

class GalleryView extends ItemView {
  private catalog: GalleryCatalog | null = null;
  private persistedState: unknown;
  private state: GalleryViewState;
  private viewRoot: PluginViewRootHandle | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    initialState: GalleryViewState,
    private readonly rememberState: (state: GalleryViewState) => void
  ) {
    super(leaf);
    this.persistedState = initialState;
    this.state = initialState;
  }

  getViewType(): string {
    return GALLERY_VIEWTYPE;
  }

  getDisplayText(): string {
    return "Component gallery";
  }

  getIcon(): string {
    return "layout-grid";
  }

  getState(): GalleryViewState {
    return this.state;
  }

  async setState(state: unknown): Promise<void> {
    this.persistedState = state;
    this.state = resolveGalleryViewState(state, this.catalog?.stories ?? []);
    this.rememberState(this.state);
    this.viewRoot?.rerender();
  }

  async onOpen(): Promise<void> {
    const storyModules = await Promise.all(
      modules.map(async ({ componentId, load }) => ({
        componentId,
        storyModule: (await load()) as LoadedStoryModule["storyModule"],
      }))
    );
    this.catalog = createGalleryCatalog(storyModules, presentationalComponentCount);
    this.state = resolveGalleryViewState(this.persistedState, this.catalog.stories);
    this.rememberState(this.state);
    this.viewRoot = mountPluginViewRoot(this.containerEl, this.app, () => this.renderTree());
  }

  private renderTree(): React.ReactNode {
    if (!this.catalog) {
      return null;
    }

    return React.createElement(Gallery, {
      catalog: this.catalog,
      onStateChange: (state) => this.updateState(state),
      state: this.state,
    });
  }

  private updateState(state: GalleryViewState): void {
    this.persistedState = state;
    this.state = resolveGalleryViewState(state, this.catalog?.stories ?? []);
    this.rememberState(this.state);
    this.viewRoot?.rerender();
    this.app.workspace.requestSaveLayout();
  }

  async onClose(): Promise<void> {
    this.rememberState(this.state);
    this.viewRoot?.unmount();
    this.viewRoot = null;
  }
}

/**
 * Manages only the development component gallery view and its open command.
 * It does not load or alter the production Copilot runtime.
 */
export default class GalleryPlugin extends Plugin {
  private lastGalleryState = resolveGalleryViewState(null, []);

  async onload(): Promise<void> {
    this.registerView(
      GALLERY_VIEWTYPE,
      (leaf: WorkspaceLeaf) =>
        new GalleryView(leaf, this.lastGalleryState, (state) => {
          this.lastGalleryState = state;
        })
    );
    this.addCommand({
      id: "open-component-gallery",
      name: "Open component gallery",
      callback: async () => {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.setViewState({
          type: GALLERY_VIEWTYPE,
          state: this.lastGalleryState,
          active: true,
        });
        this.app.workspace.revealLeaf(leaf);
      },
    });
  }
}
