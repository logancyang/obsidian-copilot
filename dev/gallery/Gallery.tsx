import { Button } from "@/components/ui/button";
import type { GalleryParameters, Host, Layout } from "@/lib/story";
import { cn } from "@/lib/utils";
import * as React from "react";

export const GALLERY_WIDTHS = [300, 340, 400, 600] as const;

export type GalleryWidth = (typeof GALLERY_WIDTHS)[number];

interface StoryModuleMeta {
  args?: object;
  component?: React.ElementType;
  parameters?: GalleryParameters;
  title: string;
}

interface StoryModule extends Record<string, unknown> {
  default: StoryModuleMeta;
}

interface StoryModuleStory {
  args?: object;
  name?: string;
  parameters?: GalleryParameters;
  render?: (args: object) => React.ReactNode;
}

export interface LoadedStoryModule {
  componentId: string | null;
  storyModule: StoryModule;
}

export interface StoryDefinition {
  exportName: string;
  host: Host;
  id: string;
  layout: Layout;
  name: string;
  render(): React.ReactNode;
  title: string;
  width?: number;
}

export interface GalleryCatalog {
  componentCount: number;
  coveredCount: number;
  stories: StoryDefinition[];
}

export interface GalleryViewState {
  contactSheet: boolean;
  selectedStoryId: string | null;
  selectedSubtree: string | null;
  width: GalleryWidth;
}

interface GalleryProps {
  catalog: GalleryCatalog;
  onStateChange: (state: GalleryViewState) => void;
  state: GalleryViewState;
}

interface StoryTreeNode {
  children: Map<string, StoryTreeNode>;
  label: string;
  path: string;
  stories: StoryDefinition[];
}

interface StoryTreeProps {
  nodes: StoryTreeNode[];
  onSelectStory: (story: StoryDefinition) => void;
  onSelectSubtree: (path: string) => void;
  selectedStoryId: string | null;
  selectedSubtree: string | null;
  showContactSheet: boolean;
}

const DEFAULT_WIDTH: GalleryWidth = 400;

function isGalleryWidth(value: unknown): value is GalleryWidth {
  return GALLERY_WIDTHS.some((width) => width === value);
}

function storyBelongsToSubtree(story: StoryDefinition, subtree: string): boolean {
  return story.title === subtree || story.title.startsWith(`${subtree}/`);
}

function storyMatchesFilter(story: StoryDefinition, filter: string): boolean {
  const query = filter.trim().toLocaleLowerCase();
  if (!query) {
    return true;
  }

  return `${story.title} ${story.name}`.toLocaleLowerCase().includes(query);
}

function buildStoryTree(stories: StoryDefinition[]): StoryTreeNode[] {
  const root = new Map<string, StoryTreeNode>();

  for (const story of stories) {
    let siblings = root;
    const segments = story.title.split("/").filter(Boolean);
    let path = "";

    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let node = siblings.get(segment);
      if (!node) {
        node = { children: new Map(), label: segment, path, stories: [] };
        siblings.set(segment, node);
      }
      siblings = node.children;

      if (path === story.title) {
        node.stories.push(story);
      }
    }
  }

  const sortNodes = (nodes: Map<string, StoryTreeNode>): StoryTreeNode[] =>
    [...nodes.values()]
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((node) => ({
        ...node,
        children: new Map(sortNodes(node.children).map((child) => [child.label, child])),
        stories: [...node.stories].sort((left, right) => left.name.localeCompare(right.name)),
      }));

  return sortNodes(root);
}

function getLayoutClassName(layout: Layout): string {
  return cn(
    "tw-bg-primary",
    layout === "padded" && "tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-4",
    layout === "centered" &&
      "tw-flex tw-min-h-64 tw-items-center tw-justify-center tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-4",
    layout === "fullscreen" && "tw-min-h-full tw-w-full"
  );
}

function renderStory(story: StoryDefinition, showHeading: boolean): React.ReactElement {
  return (
    <section
      aria-label={`${story.name} story`}
      data-gallery-host={story.host}
      data-gallery-layout={story.layout}
      data-gallery-story-id={story.id}
      key={story.id}
      className="tw-flex tw-flex-col tw-gap-2"
    >
      {showHeading && (
        <header className="tw-flex tw-items-baseline tw-justify-between tw-gap-2">
          <h3 className="tw-m-0 tw-text-ui-small tw-font-semibold">{story.name}</h3>
          <code className="tw-text-smallest tw-text-muted">{story.id}</code>
        </header>
      )}
      <div className={getLayoutClassName(story.layout)}>{story.render()}</div>
    </section>
  );
}

function StoryTree({
  nodes,
  onSelectStory,
  onSelectSubtree,
  selectedStoryId,
  selectedSubtree,
  showContactSheet,
}: StoryTreeProps): React.ReactElement {
  return (
    <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-1 tw-p-0">
      {nodes.map((node) => {
        const subtreeSelected = showContactSheet && selectedSubtree === node.path;

        return (
          <li key={node.path}>
            <button
              aria-label={`Show ${node.path} contact sheet`}
              aria-pressed={subtreeSelected}
              className={cn(
                "tw-w-full tw-cursor-pointer tw-rounded-md tw-border-none tw-bg-transparent tw-px-2 tw-py-1.5 tw-text-left tw-text-ui-small tw-font-semibold tw-text-normal hover:tw-bg-modifier-hover focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring",
                subtreeSelected && "tw-text-accent tw-bg-interactive-accent/10"
              )}
              onClick={() => onSelectSubtree(node.path)}
              type="button"
            >
              {node.label}
            </button>

            {(node.stories.length > 0 || node.children.size > 0) && (
              <div className="tw-ml-3 tw-border-l tw-border-solid tw-border-border tw-pl-2">
                {node.stories.map((story) => {
                  const selected = story.id === selectedStoryId && !showContactSheet;

                  return (
                    <button
                      aria-current={selected ? "true" : undefined}
                      className={cn(
                        "tw-my-0.5 tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-justify-between tw-gap-2 tw-rounded-md tw-border-none tw-bg-transparent tw-px-2 tw-py-1.5 tw-text-left tw-text-ui-smaller tw-text-normal hover:tw-bg-modifier-hover focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring",
                        selected &&
                          "tw-bg-interactive-accent tw-font-semibold tw-text-on-accent hover:tw-bg-interactive-accent-hover"
                      )}
                      data-gallery-story-button={story.id}
                      key={story.id}
                      onClick={() => onSelectStory(story)}
                      type="button"
                    >
                      <span>{story.name}</span>
                      {selected && <span className="tw-text-smallest">Selected</span>}
                    </button>
                  );
                })}
                {node.children.size > 0 && (
                  <StoryTree
                    nodes={[...node.children.values()]}
                    onSelectStory={onSelectStory}
                    onSelectSubtree={onSelectSubtree}
                    selectedStoryId={selectedStoryId}
                    selectedSubtree={selectedSubtree}
                    showContactSheet={showContactSheet}
                  />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Converts dynamically imported story modules into the stable catalog consumed by the gallery.
 *
 * @param storyModules - Loaded CSF modules paired with generator-derived component identities.
 * @param presentationalComponentCount - Number of presentational components found by the indexer.
 */
export function createGalleryCatalog(
  storyModules: LoadedStoryModule[],
  presentationalComponentCount: number
): GalleryCatalog {
  const coveredComponentIds = new Set<string>();
  const optedOutComponentIds = new Set<string>();
  const stories: StoryDefinition[] = [];

  for (const { componentId, storyModule } of storyModules) {
    const meta = storyModule.default;

    if (componentId) {
      if (meta.parameters?.gallery?.coverage === false) {
        optedOutComponentIds.add(componentId);
      } else {
        coveredComponentIds.add(componentId);
      }
    }

    for (const [exportName, value] of Object.entries(storyModule)) {
      if (exportName === "default") {
        continue;
      }

      const story = value as StoryModuleStory;
      const id = `${meta.title}/${exportName}`;
      const args = { ...meta.args, ...story.args };
      const gallery = { ...meta.parameters?.gallery, ...story.parameters?.gallery };

      if (!story.render && !meta.component) {
        throw new Error(`Story "${id}" must define render or meta.component`);
      }

      stories.push({
        exportName,
        host: gallery.host ?? "leaf",
        id,
        layout: gallery.layout ?? "padded",
        name: story.name ?? exportName,
        render: () =>
          story.render ? story.render(args) : React.createElement(meta.component!, args),
        title: meta.title,
        width: gallery.width,
      });
    }
  }

  return {
    componentCount: presentationalComponentCount - optedOutComponentIds.size,
    coveredCount: coveredComponentIds.size,
    stories: stories.sort(
      (left, right) => left.title.localeCompare(right.title) || left.name.localeCompare(right.name)
    ),
  };
}

/**
 * Restores only valid gallery state and falls back to the first available story when needed.
 *
 * @param value - ItemView state supplied by Obsidian or the current controlled gallery state.
 * @param stories - Available stories used to validate persisted identities and metadata defaults.
 */
export function resolveGalleryViewState(
  value: unknown,
  stories: StoryDefinition[]
): GalleryViewState {
  const state = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const requestedStoryId = typeof state.selectedStoryId === "string" ? state.selectedStoryId : null;
  const selectedStory =
    stories.find((story) => story.id === requestedStoryId) ?? stories[0] ?? null;
  const selectedStoryId = stories.length > 0 ? (selectedStory?.id ?? null) : requestedStoryId;
  const requestedSubtree = typeof state.selectedSubtree === "string" ? state.selectedSubtree : null;
  const selectedSubtreeIsValid =
    requestedSubtree !== null &&
    (stories.length === 0 ||
      stories.some((story) => storyBelongsToSubtree(story, requestedSubtree)));
  const selectedSubtree = selectedSubtreeIsValid
    ? requestedSubtree
    : (selectedStory?.title ?? null);
  const width = isGalleryWidth(state.width)
    ? state.width
    : isGalleryWidth(selectedStory?.width)
      ? selectedStory.width
      : DEFAULT_WIDTH;

  return {
    contactSheet: state.contactSheet === true,
    selectedStoryId,
    selectedSubtree,
    width,
  };
}

/**
 * Renders the gallery navigation and canvas while the ItemView remains the persistence owner.
 *
 * @param props - Catalog, persisted state, and the callback used to save user navigation changes.
 */
export function Gallery({ catalog, onStateChange, state }: GalleryProps): React.ReactElement {
  const [filter, setFilter] = React.useState("");
  const filteredStories = React.useMemo(
    () => catalog.stories.filter((story) => storyMatchesFilter(story, filter)),
    [catalog.stories, filter]
  );
  const storyTree = React.useMemo(() => buildStoryTree(filteredStories), [filteredStories]);
  const selectedStory = catalog.stories.find((story) => story.id === state.selectedStoryId) ?? null;
  const selectedSubtree = state.selectedSubtree ?? selectedStory?.title ?? null;
  const contactSheetStories = selectedSubtree
    ? catalog.stories.filter(
        (story) => story.host === "leaf" && storyBelongsToSubtree(story, selectedSubtree)
      )
    : [];
  const skippedHostCount = selectedSubtree
    ? catalog.stories.filter(
        (story) => story.host !== "leaf" && storyBelongsToSubtree(story, selectedSubtree)
      ).length
    : 0;

  const selectStory = (story: StoryDefinition) => {
    onStateChange({
      ...state,
      contactSheet: false,
      selectedStoryId: story.id,
      selectedSubtree: story.title,
      width: isGalleryWidth(story.width) ? story.width : state.width,
    });
  };

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    if ((event.target as HTMLElement).closest("input")) {
      return;
    }

    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-gallery-story-button]"),
    ];
    if (buttons.length === 0) {
      return;
    }

    event.preventDefault();
    const selectedIndex = filteredStories.findIndex((story) => story.id === state.selectedStoryId);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      selectedIndex < 0
        ? direction > 0
          ? 0
          : filteredStories.length - 1
        : (selectedIndex + direction + filteredStories.length) % filteredStories.length;
    const nextStory = filteredStories[nextIndex];
    selectStory(nextStory);
    buttons[nextIndex]?.focus();
  };

  const selectSubtree = (path: string) => {
    onStateChange({ ...state, contactSheet: true, selectedSubtree: path });
  };

  const toggleContactSheet = () => {
    onStateChange({
      ...state,
      contactSheet: !state.contactSheet,
      selectedSubtree,
    });
  };

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-bg-primary tw-text-normal">
      <aside
        aria-label="Component and story navigation"
        className="tw-flex tw-w-64 tw-shrink-0 tw-flex-col tw-border-r tw-border-solid tw-border-border tw-bg-secondary"
        onKeyDown={handleTreeKeyDown}
      >
        <header className="tw-flex tw-flex-col tw-gap-1 tw-border-b tw-border-solid tw-border-border tw-p-3">
          <h1 className="tw-m-0 tw-text-ui-medium tw-font-semibold">Component gallery</h1>
          <p className="tw-m-0 tw-text-smallest tw-text-muted" data-gallery-coverage-summary>
            {catalog.componentCount} presentational components · {catalog.coveredCount} with stories
            · {catalog.componentCount - catalog.coveredCount} missing
          </p>
        </header>

        <div className="tw-flex tw-flex-col tw-gap-2 tw-border-b tw-border-solid tw-border-border tw-p-3">
          <label className="tw-flex tw-flex-col tw-gap-1 tw-text-ui-smaller tw-font-medium">
            Filter components and stories
            <input
              aria-label="Filter components and stories"
              className="tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-2 tw-py-1.5 tw-text-normal focus:tw-border-interactive-accent focus:tw-outline-none"
              onChange={(event) => setFilter(event.currentTarget.value)}
              placeholder="Type a title or story"
              type="search"
              value={filter}
            />
          </label>
          <Button
            aria-pressed={state.contactSheet}
            onClick={toggleContactSheet}
            size="sm"
            type="button"
            variant={state.contactSheet ? "default" : "secondary"}
          >
            {state.contactSheet ? "Show selected story" : "Show subtree contact sheet"}
          </Button>
          <p className="tw-m-0 tw-text-smallest tw-text-muted">
            Subtree: <strong>{selectedSubtree ?? "None"}</strong>
          </p>
        </div>

        <nav aria-label="Story tree" className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-p-2">
          {storyTree.length > 0 ? (
            <StoryTree
              nodes={storyTree}
              onSelectStory={selectStory}
              onSelectSubtree={selectSubtree}
              selectedStoryId={state.selectedStoryId}
              selectedSubtree={selectedSubtree}
              showContactSheet={state.contactSheet}
            />
          ) : (
            <p className="tw-m-2 tw-text-ui-smaller tw-text-muted">No matching stories.</p>
          )}
        </nav>
      </aside>

      <main className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-overflow-hidden">
        <header className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3 tw-border-b tw-border-solid tw-border-border tw-p-4">
          <div className="tw-min-w-0">
            <p className="tw-m-0 tw-text-smallest tw-font-semibold tw-uppercase tw-text-muted">
              {state.contactSheet ? "Current subtree" : "Current story"}
            </p>
            <h2 className="tw-m-0 tw-text-ui-medium tw-font-semibold">
              {state.contactSheet
                ? selectedSubtree
                : selectedStory
                  ? `${selectedStory.title.split("/").join(" / ")} / ${selectedStory.name}`
                  : "No story selected"}
            </h2>
            {!state.contactSheet && selectedStory && (
              <code className="tw-text-ui-smaller tw-text-accent">{selectedStory.id}</code>
            )}
            {state.contactSheet && (
              <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
                {contactSheetStories.length} leaf{" "}
                {contactSheetStories.length === 1 ? "story" : "stories"}
                {skippedHostCount > 0 && ` · ${skippedHostCount} non-leaf skipped`}
              </p>
            )}
          </div>

          <div className="tw-flex tw-flex-col tw-items-end tw-gap-1">
            <div aria-label="Story width" className="tw-flex tw-flex-wrap tw-justify-end tw-gap-1">
              {GALLERY_WIDTHS.map((width) => (
                <Button
                  aria-pressed={state.width === width}
                  key={width}
                  onClick={() => onStateChange({ ...state, width })}
                  size="sm"
                  type="button"
                  variant={state.width === width ? "default" : "secondary"}
                >
                  {width}
                </Button>
              ))}
            </div>
            <p className="tw-m-0 tw-text-smallest tw-text-muted">
              Current width: <strong>{state.width}px</strong>
            </p>
            <p className="tw-m-0 tw-text-smallest tw-text-muted">
              Switch themes in Obsidian settings; the gallery follows.
            </p>
          </div>
        </header>

        <div className="tw-min-h-0 tw-flex-1 tw-overflow-auto tw-p-4">
          <div className="tw-flex tw-min-w-max tw-justify-center">
            <div
              className="copilot-gallery-canvas tw-flex tw-flex-col tw-gap-4"
              data-gallery-width={state.width}
            >
              {state.contactSheet ? (
                contactSheetStories.length > 0 ? (
                  contactSheetStories.map((story) => renderStory(story, true))
                ) : (
                  <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
                    This subtree has no leaf-hosted stories to render inline.
                  </p>
                )
              ) : selectedStory ? (
                renderStory(selectedStory, false)
              ) : (
                <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">No story selected.</p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
