import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import { ItemView, Plugin, type WorkspaceLeaf } from "obsidian";
import * as React from "react";
import {
  createGalleryCatalog,
  Gallery,
  GALLERY_WIDTHS,
  type GalleryCatalog,
  type GalleryHostChange,
  type GalleryViewState,
  type LoadedStoryModule,
  resolveGalleryViewState,
} from "./Gallery";
import {
  type AuditFinding,
  type AuditReport,
  getGalleryTheme,
  inspectStoryCase,
  resolveObsidianColorTokens,
} from "./audit";
import { modules, presentationalComponentCount } from "./stories.generated";

export const GALLERY_VIEWTYPE = "copilot-component-gallery";

export interface GalleryShowOptions {
  width?: number;
}

export interface GalleryAuditOptions {
  widths?: number[];
}

export interface GalleryHandle {
  audit(options?: GalleryAuditOptions): Promise<AuditReport[]>;
  list(): string[];
  show(id: string, options?: GalleryShowOptions): Promise<void>;
}

declare global {
  interface Window {
    __gallery?: GalleryHandle;
  }
}

interface ActiveHost {
  close: () => void;
  storyId: string;
}

const EMPTY_STORY_IDS = Object.freeze([]) as unknown as string[];
const STORY_MOUNT_ATTEMPTS = 100;

interface GalleryWindow extends Window {
  MessageChannel: typeof MessageChannel;
}

function isPositiveWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitForLayout(win: Window): Promise<void> {
  const MessageChannelConstructor = (win as Partial<GalleryWindow>).MessageChannel;
  if (
    MessageChannelConstructor &&
    (!win.document.hasFocus() || win.document.visibilityState !== "visible")
  ) {
    return new Promise((resolve) => {
      const channel = new MessageChannelConstructor();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let frame = 0;
    let timeout = 0;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      win.clearTimeout(timeout);
      win.cancelAnimationFrame(frame);
      resolve();
    };
    frame = win.requestAnimationFrame(finish);
    timeout = win.setTimeout(finish, 50);
  });
}

class GalleryView extends ItemView {
  private activeHost: ActiveHost | null = null;
  private persistedState: unknown;
  private renderRevision = 0;
  private state: GalleryViewState;
  private viewRoot: PluginViewRootHandle | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly catalog: GalleryCatalog,
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
    this.state = resolveGalleryViewState(state, this.catalog.stories);
    this.rememberState(this.state);
    this.viewRoot?.rerender();
  }

  async onOpen(): Promise<void> {
    this.state = resolveGalleryViewState(this.persistedState, this.catalog.stories);
    this.rememberState(this.state);
    this.viewRoot = mountPluginViewRoot(this.containerEl, this.app, () => this.renderTree());
  }

  private renderTree(): React.ReactNode {
    return React.createElement(Gallery, {
      catalog: this.catalog,
      onHostChange: this.handleHostChange,
      onStateChange: (state) => this.updateState(state),
      renderRevision: this.renderRevision,
      state: this.state,
    });
  }

  private readonly handleHostChange: GalleryHostChange = (storyId, close) => {
    if (close) {
      this.activeHost = { close, storyId };
    } else if (this.activeHost?.storyId === storyId) {
      this.activeHost = null;
    }
  };

  private updateState(state: GalleryViewState): void {
    this.persistedState = state;
    this.state = resolveGalleryViewState(state, this.catalog.stories);
    this.rememberState(this.state);
    this.viewRoot?.rerender();
    this.app.workspace.requestSaveLayout();
  }

  private renderTemporaryState(state: GalleryViewState): void {
    this.state = resolveGalleryViewState(state, this.catalog.stories);
    this.renderRevision += 1;
    this.viewRoot?.rerender();
  }

  private findMountedStory(storyId: string, width?: number): HTMLElement | null {
    return (
      [...this.containerEl.doc.querySelectorAll<HTMLElement>("[data-story]")].find(
        (element) =>
          element.dataset.story === storyId &&
          (width === undefined || element.dataset.storyWidth === String(width))
      ) ?? null
    );
  }

  private async waitForMountedStory(storyId: string, width: number): Promise<HTMLElement> {
    const win = this.containerEl.win;
    for (let attempt = 0; attempt < STORY_MOUNT_ATTEMPTS; attempt += 1) {
      await waitForLayout(win);
      const mounted = this.findMountedStory(storyId, width);
      if (mounted) {
        await waitForLayout(win);
        if (mounted.isConnected) {
          return mounted;
        }
      }
    }

    throw new Error(`Story "${storyId}" did not mount at ${width}px`);
  }

  private async closeActiveHost(): Promise<void> {
    const activeHost = this.activeHost;
    if (!activeHost) {
      return;
    }

    this.activeHost = null;
    activeHost.close();
    await waitForLayout(this.containerEl.win);
    await waitForLayout(this.containerEl.win);
  }

  private async renderStory(
    storyId: string,
    width: number,
    persist: boolean
  ): Promise<HTMLElement> {
    const story = this.catalog.stories.find((candidate) => candidate.id === storyId);
    if (!story) {
      throw new Error(`Unknown gallery story "${storyId}"`);
    }

    await this.closeActiveHost();
    const nextState = {
      ...this.state,
      contactSheet: false,
      selectedStoryId: story.id,
      selectedSubtree: story.title,
      width,
    };
    this.renderRevision += 1;
    if (persist) {
      this.updateState(nextState);
    } else {
      this.state = resolveGalleryViewState(nextState, this.catalog.stories);
      this.viewRoot?.rerender();
    }
    return this.waitForMountedStory(story.id, width);
  }

  async showStory(storyId: string, width?: number): Promise<void> {
    const requestedWidth = width ?? this.state.width;
    if (!isPositiveWidth(requestedWidth)) {
      throw new Error("Gallery width must be a positive finite number");
    }
    await this.renderStory(storyId, requestedWidth, true);
  }

  async auditStories(widths: number[]): Promise<AuditReport[]> {
    const previousState = this.state;
    const reports: AuditReport[] = [];
    const vaultWithConfig = this.app.vault as unknown as
      | { getConfig?: (key: string) => unknown }
      | undefined;
    const configuredTheme = vaultWithConfig?.getConfig?.("cssTheme");
    const themeName = typeof configuredTheme === "string" ? configuredTheme : undefined;
    const tokenColors = resolveObsidianColorTokens(this.containerEl.doc);

    try {
      for (const width of widths) {
        const findings: AuditFinding[] = [];

        for (const story of this.catalog.stories) {
          try {
            const mounted = await this.renderStory(story.id, width, false);
            findings.push(...inspectStoryCase(mounted, tokenColors));
          } catch (error) {
            findings.push({
              story: story.id,
              check: "render-failure",
              detail: errorMessage(error),
            });
          } finally {
            await this.closeActiveHost();
          }
        }

        reports.push({
          theme: getGalleryTheme(this.containerEl.doc, themeName),
          width,
          findings,
        });
      }
    } finally {
      await this.closeActiveHost();
      this.renderTemporaryState(previousState);
      await waitForLayout(this.containerEl.win);
    }

    return reports;
  }

  async onClose(): Promise<void> {
    await this.closeActiveHost();
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
  private catalog: GalleryCatalog = createGalleryCatalog([], 0);
  private externalOperationQueue: Promise<void> = Promise.resolve();
  private galleryHandle: GalleryHandle | null = null;
  private lastGalleryState = resolveGalleryViewState(null, []);

  async onload(): Promise<void> {
    const storyModules = await Promise.all(
      modules.map(async ({ componentId, load }) => ({
        componentId,
        storyModule: (await load()) as LoadedStoryModule["storyModule"],
      }))
    );
    this.catalog = createGalleryCatalog(storyModules, presentationalComponentCount);
    this.lastGalleryState = resolveGalleryViewState(this.lastGalleryState, this.catalog.stories);

    this.registerView(
      GALLERY_VIEWTYPE,
      (leaf: WorkspaceLeaf) =>
        new GalleryView(leaf, this.catalog, this.lastGalleryState, (state) => {
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

    const storyIds = this.catalog.stories.map((story) => story.id);
    this.galleryHandle = {
      list: () => (storyIds.length > 0 ? [...storyIds] : EMPTY_STORY_IDS),
      show: async (id, options) => {
        if (options?.width !== undefined && !isPositiveWidth(options.width)) {
          throw new Error("Gallery width must be a positive finite number");
        }
        await this.enqueueExternalOperation(async () => {
          const view = await this.openControlledView();
          await view.showStory(id, options?.width);
        });
      },
      audit: async (options) => {
        const requestedWidths = options?.widths ?? [...GALLERY_WIDTHS];
        if (requestedWidths.some((width) => !isPositiveWidth(width))) {
          throw new Error("Gallery audit widths must be positive finite numbers");
        }
        const widths = [...new Set(requestedWidths)];
        return this.enqueueExternalOperation(async () => {
          const view = await this.openControlledView();
          return view.auditStories(widths);
        });
      },
    };
    window.__gallery = this.galleryHandle;
  }

  private enqueueExternalOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.externalOperationQueue.then(operation);
    this.externalOperationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async openControlledView(): Promise<GalleryView> {
    const existingLeaves = this.app.workspace.getLeavesOfType(GALLERY_VIEWTYPE);
    let leaf = existingLeaves.find((candidate) => candidate.view instanceof GalleryView);

    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({
        type: GALLERY_VIEWTYPE,
        state: this.lastGalleryState,
        active: true,
      });
    }

    this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof GalleryView)) {
      throw new Error("Obsidian did not initialize the component gallery view");
    }
    return leaf.view;
  }

  onunload(): void {
    if (window.__gallery === this.galleryHandle) {
      delete window.__gallery;
    }
    this.galleryHandle = null;
  }
}
