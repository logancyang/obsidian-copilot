import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ReactModal } from "@/components/modals/ReactModal";
import { useApp } from "@/context";
import type { GalleryParameters, Host, Layout } from "@/lib/story";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { App } from "obsidian";
import * as React from "react";

export const GALLERY_WIDTHS = [300, 340, 400, 600] as const;
type GalleryPresetWidth = (typeof GALLERY_WIDTHS)[number];

export type GalleryHostChange = (storyId: string, close: (() => void) | null) => void;
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
  render?: React.ComponentType<object>;
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
  /** Extra class for the `modal` host's frame; see `GalleryParameters`. */
  modalClass?: string;
  name: string;
  render(): React.ReactNode;
  title: string;
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
  width: number;
}

interface GalleryProps {
  catalog: GalleryCatalog;
  ownerId: string;
  onHostChange?: GalleryHostChange;
  onStateChange: (state: GalleryViewState) => void;
  renderRevision?: number;
  state: GalleryViewState;
}

interface StoryTreeNode {
  children: Map<string, StoryTreeNode>;
  label: string;
  path: string;
  stories: StoryDefinition[];
}

interface StoryTreeProps {
  depth?: number;
  expandAll: boolean;
  expandedSubtrees: ReadonlySet<string>;
  nodes: StoryTreeNode[];
  onSelectStory: (story: StoryDefinition) => void;
  onSelectSubtree: (path: string) => void;
  onToggleSubtree: (path: string, expanded: boolean) => void;
  selectedStoryId: string | null;
  selectedStoryTitle: string | null;
  selectedSubtree: string | null;
  showContactSheet: boolean;
}

interface StoryHostProps {
  onHostChange?: GalleryHostChange;
  ownerId: string;
  story: StoryDefinition;
  width: number;
}

interface CustomWidthControlProps {
  onApply: (width: number) => void;
  width: number;
}

interface CustomWidthDraft {
  sourceWidth: number;
  value: string;
}

const DEFAULT_WIDTH: GalleryPresetWidth = 400;

function isPositiveWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function CustomWidthControl({ onApply, width }: CustomWidthControlProps): React.ReactElement {
  const widthIsPreset = GALLERY_WIDTHS.some((presetWidth) => presetWidth === width);
  const defaultDraft = widthIsPreset ? "" : String(width);
  const [draftState, setDraftState] = React.useState<CustomWidthDraft>(() => ({
    sourceWidth: width,
    value: defaultDraft,
  }));
  if (draftState.sourceWidth !== width) {
    setDraftState({ sourceWidth: width, value: defaultDraft });
  }
  const draft = draftState.sourceWidth === width ? draftState.value : defaultDraft;
  const parsedWidth = Number(draft);
  const draftIsValid =
    draft.trim() !== "" && Number.isInteger(parsedWidth) && isPositiveWidth(parsedWidth);

  const apply = () => {
    if (draftIsValid) {
      onApply(parsedWidth);
    }
  };

  const resetInvalidDraft = () => {
    if (!draftIsValid) {
      setDraftState({ sourceWidth: width, value: defaultDraft });
    }
  };

  return (
    <>
      <input
        aria-invalid={draft !== "" && !draftIsValid}
        aria-label="Custom story width in pixels"
        className={cn(
          "tw-h-6 tw-w-24 tw-rounded-md tw-border tw-border-solid tw-bg-primary tw-px-2 tw-text-center tw-text-ui-smaller tw-text-normal focus:tw-border-border-focus focus:tw-outline-none",
          widthIsPreset ? "tw-border-border" : "tw-border-interactive-accent",
          draft !== "" && !draftIsValid && "tw-border-error"
        )}
        inputMode="numeric"
        min={1}
        onBlur={resetInvalidDraft}
        onChange={(event) =>
          setDraftState({ sourceWidth: width, value: event.currentTarget.value })
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            apply();
          } else if (event.key === "Escape") {
            setDraftState({ sourceWidth: width, value: defaultDraft });
          }
        }}
        placeholder="Custom px"
        step={1}
        title="Enter 1920 for a 1080p-wide viewport"
        type="number"
        value={draft}
      />
      <Button
        aria-label="Apply custom width"
        disabled={!draftIsValid}
        onClick={apply}
        size="sm"
        type="button"
        variant="secondary"
      >
        Apply
      </Button>
    </>
  );
}

function isWithinSubtree(path: string, subtree: string): boolean {
  return path === subtree || path.startsWith(`${subtree}/`);
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
    layout === "fullscreen" && "tw-size-full"
  );
}

interface StoryErrorBoundaryProps {
  children: React.ReactNode;
  storyId: string;
}

interface StoryErrorBoundaryState {
  error: string | null;
}

class StoryErrorBoundary extends React.Component<StoryErrorBoundaryProps, StoryErrorBoundaryState> {
  state: StoryErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): StoryErrorBoundaryState {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  render(): React.ReactNode {
    if (this.state.error !== null) {
      return (
        <div
          className="tw-rounded-md tw-border tw-border-solid tw-border-error tw-bg-error tw-p-3 tw-text-error"
          data-story-render-error={this.state.error}
          role="alert"
        >
          {this.props.storyId}: {this.state.error}
        </div>
      );
    }

    return this.props.children;
  }
}

function StoryContent({ story }: { story: StoryDefinition }): React.ReactElement {
  return <>{story.render()}</>;
}

function renderStoryContent(story: StoryDefinition): React.ReactElement {
  return (
    <StoryErrorBoundary key={story.id} storyId={story.id}>
      <StoryContent story={story} />
    </StoryErrorBoundary>
  );
}

class GalleryStoryModal extends ReactModal {
  constructor(
    app: App,
    private readonly story: StoryDefinition,
    private width: number,
    private readonly ownerId: string,
    private readonly onDidClose: () => void
  ) {
    super(app, story.name, story.modalClass);
  }

  protected renderContent(): React.ReactElement {
    return (
      <div
        data-gallery-host="modal"
        data-gallery-host-content
        data-gallery-story-id={this.story.id}
        data-gallery-owner={this.ownerId}
        data-story={this.story.id}
        data-story-width={this.width}
        style={{ maxWidth: "100%", width: this.width }}
      >
        {renderStoryContent(this.story)}
      </div>
    );
  }

  onClose(): void {
    super.onClose();
    this.onDidClose();
  }

  setWidth(width: number): void {
    this.width = width;
    const storyElement = this.contentEl.querySelector<HTMLElement>("[data-story]");
    if (storyElement) {
      storyElement.dataset.storyWidth = String(width);
      storyElement.style.width = `${width}px`;
    }
  }
}

function ModalStoryHost({
  onHostChange,
  ownerId,
  story,
  width,
}: StoryHostProps): React.ReactElement {
  const app = useApp();
  const activeModal = React.useRef<GalleryStoryModal | null>(null);
  const widthRef = React.useRef(width);
  widthRef.current = width;
  const openModal = React.useCallback(() => {
    activeModal.current?.close();
    const modal = new GalleryStoryModal(app, story, widthRef.current, ownerId, () => {
      if (activeModal.current === modal) {
        activeModal.current = null;
        onHostChange?.(story.id, null);
      }
    });
    activeModal.current = modal;
    modal.open();
    onHostChange?.(story.id, () => modal.close());
  }, [app, onHostChange, ownerId, story]);

  React.useEffect(() => {
    openModal();
    return () => {
      const modal = activeModal.current;
      activeModal.current = null;
      modal?.close();
      onHostChange?.(story.id, null);
    };
  }, [onHostChange, openModal, story.id]);

  React.useEffect(() => {
    activeModal.current?.setWidth(width);
  }, [width]);

  return (
    <div className="tw-flex tw-flex-col tw-items-start tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-4">
      <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
        This story is mounted in a native Obsidian modal.
      </p>
      <Button onClick={openModal} type="button">
        Reopen modal story
      </Button>
    </div>
  );
}

function PopoverStoryHost({
  onHostChange,
  ownerId,
  story,
  width,
}: StoryHostProps): React.ReactElement {
  const [open, setOpen] = React.useState(true);
  const [portalContainer, setPortalContainer] = React.useState<HTMLElement | null>(null);
  const rememberTrigger = React.useCallback((trigger: HTMLButtonElement | null) => {
    setPortalContainer(trigger?.doc.body ?? null);
  }, []);

  React.useEffect(() => {
    onHostChange?.(story.id, open ? () => setOpen(false) : null);
    return () => onHostChange?.(story.id, null);
  }, [onHostChange, open, story.id]);

  return (
    <div className="tw-flex tw-min-h-32 tw-items-start tw-justify-center tw-p-4">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button ref={rememberTrigger} type="button">
            Toggle popover story
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          container={portalContainer}
          data-gallery-host="popover"
          data-gallery-host-content
          data-gallery-owner={ownerId}
          data-gallery-story-id={story.id}
          data-story={story.id}
          data-story-width={width}
          style={{ maxWidth: "100%", width }}
        >
          {renderStoryContent(story)}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* eslint-disable tailwindcss/no-custom-classname -- These are Obsidian's native settings host classes, not gallery styling. */
function SettingsTabStoryHost({
  onHostChange,
  ownerId,
  story,
  width,
}: StoryHostProps): React.ReactElement {
  const [open, setOpen] = React.useState(true);

  React.useEffect(() => {
    onHostChange?.(story.id, open ? () => setOpen(false) : null);
    return () => onHostChange?.(story.id, null);
  }, [onHostChange, open, story.id]);

  if (!open) {
    return <></>;
  }

  return (
    <div
      className="modal mod-settings"
      data-gallery-host="settings-tab"
      data-gallery-host-content
      data-gallery-owner={ownerId}
      data-gallery-story-id={story.id}
      data-story={story.id}
      data-story-width={width}
      style={{ maxWidth: "100%", width }}
    >
      <div className="modal-content">
        <div className="vertical-tabs">
          <div className="vertical-tab-content-container">
            <div className="vertical-tab-content">{renderStoryContent(story)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
/* eslint-enable tailwindcss/no-custom-classname -- resume checking outside the Obsidian settings host */

function renderLeafStory(
  story: StoryDefinition,
  showHeading: boolean,
  width: number,
  ownerId: string,
  renderRevision = 0
): React.ReactElement {
  return (
    <section
      aria-label={`${story.name} story`}
      data-gallery-host={story.host}
      data-gallery-layout={story.layout}
      data-gallery-owner={ownerId}
      data-gallery-story-id={story.id}
      data-story={story.id}
      data-story-width={width}
      key={`${story.id}:${renderRevision}`}
      className={cn("tw-flex tw-flex-col tw-gap-2", story.layout === "fullscreen" && "tw-h-full")}
    >
      {showHeading && (
        <header className="tw-flex tw-items-baseline tw-justify-between tw-gap-2">
          <h3 className="tw-m-0 tw-min-w-0 tw-break-words tw-text-ui-small tw-font-semibold">
            {story.name}
          </h3>
          <code className="tw-min-w-0 tw-break-all tw-text-right tw-text-smallest tw-text-muted">
            {story.id}
          </code>
        </header>
      )}
      <div className={getLayoutClassName(story.layout)}>{renderStoryContent(story)}</div>
    </section>
  );
}

function renderSelectedStory(
  story: StoryDefinition,
  width: number,
  renderRevision: number,
  ownerId: string,
  onHostChange?: GalleryHostChange
): React.ReactElement {
  if (story.host === "leaf") {
    return renderLeafStory(story, false, width, ownerId, renderRevision);
  }

  return (
    <section
      aria-label={`${story.name} story`}
      className="tw-flex tw-flex-col tw-gap-2"
      data-gallery-host={story.host}
      data-gallery-layout={story.layout}
      data-gallery-owner={ownerId}
      data-gallery-story-id={story.id}
      key={`${story.id}:${renderRevision}`}
    >
      {story.host === "modal" && (
        <ModalStoryHost onHostChange={onHostChange} ownerId={ownerId} story={story} width={width} />
      )}
      {story.host === "popover" && (
        <PopoverStoryHost
          onHostChange={onHostChange}
          ownerId={ownerId}
          story={story}
          width={width}
        />
      )}
      {story.host === "settings-tab" && (
        <SettingsTabStoryHost
          onHostChange={onHostChange}
          ownerId={ownerId}
          story={story}
          width={width}
        />
      )}
    </section>
  );
}

function renderHostCard(
  story: StoryDefinition,
  onOpen: (story: StoryDefinition) => void
): React.ReactElement {
  return (
    <article
      className="tw-flex tw-flex-col tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-4"
      data-gallery-host-card={story.host}
      key={story.id}
    >
      <div className="tw-flex tw-items-baseline tw-justify-between tw-gap-2">
        <h3 className="tw-m-0 tw-text-ui-small tw-font-semibold">{story.name}</h3>
        <span className="tw-text-smallest tw-text-muted">{story.host}</span>
      </div>
      <code className="tw-text-smallest tw-text-muted">{story.id}</code>
      <Button onClick={() => onOpen(story)} size="sm" type="button">
        Open {story.host} story
      </Button>
    </article>
  );
}

function StoryTree({
  depth = 0,
  expandAll,
  expandedSubtrees,
  nodes,
  onSelectStory,
  onSelectSubtree,
  onToggleSubtree,
  selectedStoryId,
  selectedStoryTitle,
  selectedSubtree,
  showContactSheet,
}: StoryTreeProps): React.ReactElement {
  return (
    <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-1 tw-p-0">
      {nodes.map((node) => {
        const subtreeSelected = showContactSheet && selectedSubtree === node.path;
        const canFold = depth > 0;
        const containsSelectedStory =
          !showContactSheet &&
          selectedStoryTitle !== null &&
          isWithinSubtree(selectedStoryTitle, node.path);
        const expanded =
          !canFold || expandAll || containsSelectedStory || expandedSubtrees.has(node.path);

        return (
          <li key={node.path}>
            <div className="tw-flex tw-items-center">
              {canFold && (
                <Button
                  aria-expanded={expanded}
                  aria-label={
                    expandAll
                      ? `${node.path} subtree is expanded while filtering`
                      : containsSelectedStory
                        ? `${node.path} subtree contains selected story`
                        : `${expanded ? "Fold" : "Unfold"} ${node.path} subtree`
                  }
                  className="tw-size-6 tw-shrink-0"
                  disabled={expandAll || containsSelectedStory}
                  onClick={() => onToggleSubtree(node.path, expanded)}
                  size="icon"
                  type="button"
                  variant="ghost2"
                >
                  {expanded ? (
                    <ChevronDown className="tw-size-3" />
                  ) : (
                    <ChevronRight className="tw-size-3" />
                  )}
                </Button>
              )}
              <Button
                aria-label={`Show ${node.path} contact sheet`}
                aria-pressed={subtreeSelected}
                className="tw-min-w-0 tw-flex-1 tw-justify-start tw-pl-2 tw-text-left tw-font-semibold"
                onClick={() => {
                  onSelectSubtree(node.path);
                  if (canFold && !expandAll) {
                    onToggleSubtree(node.path, expanded);
                  }
                }}
                size="sm"
                type="button"
                variant={subtreeSelected ? "default" : "ghost2"}
              >
                {node.label}
              </Button>
            </div>

            {expanded && (node.stories.length > 0 || node.children.size > 0) && (
              <div className="copilot-gallery-divider-l tw-ml-3 tw-pl-2">
                {node.stories.map((story) => {
                  const selected = story.id === selectedStoryId && !showContactSheet;

                  return (
                    <Button
                      aria-current={selected ? "true" : undefined}
                      className={cn(
                        "tw-my-0.5 tw-w-full tw-justify-between tw-text-left",
                        selected && "tw-font-semibold"
                      )}
                      data-gallery-story-button={story.id}
                      key={story.id}
                      onClick={() => onSelectStory(story)}
                      size="sm"
                      type="button"
                      variant={selected ? "default" : "ghost2"}
                    >
                      <span>{story.name}</span>
                    </Button>
                  );
                })}
                {node.children.size > 0 && (
                  <StoryTree
                    depth={depth + 1}
                    expandAll={expandAll}
                    expandedSubtrees={expandedSubtrees}
                    nodes={[...node.children.values()]}
                    onSelectStory={onSelectStory}
                    onSelectSubtree={onSelectSubtree}
                    onToggleSubtree={onToggleSubtree}
                    selectedStoryId={selectedStoryId}
                    selectedStoryTitle={selectedStoryTitle}
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
    const hasStories = Object.keys(storyModule).some((exportName) => exportName !== "default");

    if (componentId) {
      if (meta.parameters?.gallery?.coverage === false) {
        optedOutComponentIds.add(componentId);
      } else if (hasStories) {
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
        modalClass: gallery.modalClass,
        name: story.name ?? exportName,
        render: () =>
          story.render
            ? React.createElement(story.render, args)
            : React.createElement(meta.component!, args),
        title: meta.title,
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
 * @param stories - Available stories used to validate persisted identities.
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
      stories.some((story) => isWithinSubtree(story.title, requestedSubtree)));
  const selectedSubtree = selectedSubtreeIsValid
    ? requestedSubtree
    : (selectedStory?.title ?? null);
  const width = isPositiveWidth(state.width) ? state.width : DEFAULT_WIDTH;

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
export function Gallery({
  catalog,
  onHostChange,
  onStateChange,
  ownerId,
  renderRevision = 0,
  state,
}: GalleryProps): React.ReactElement {
  const [filter, setFilter] = React.useState("");
  const filteredStories = React.useMemo(
    () => catalog.stories.filter((story) => storyMatchesFilter(story, filter)),
    [catalog.stories, filter]
  );
  const storyTree = React.useMemo(() => buildStoryTree(filteredStories), [filteredStories]);
  const selectedStory = catalog.stories.find((story) => story.id === state.selectedStoryId) ?? null;
  const selectedStoryTitle = selectedStory?.title ?? null;
  const selectedSubtree = state.selectedSubtree ?? selectedStory?.title ?? null;
  const [expandedSubtrees, setExpandedSubtrees] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );

  const contactSheetStories = selectedSubtree
    ? catalog.stories.filter(
        (story) => story.host === "leaf" && isWithinSubtree(story.title, selectedSubtree)
      )
    : [];
  const hostCardStories = selectedSubtree
    ? catalog.stories.filter(
        (story) => story.host !== "leaf" && isWithinSubtree(story.title, selectedSubtree)
      )
    : [];
  const selectStory = (story: StoryDefinition) => {
    onStateChange({
      ...state,
      contactSheet: false,
      selectedStoryId: story.id,
      selectedSubtree: story.title,
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
    const siblingStories = filteredStories.filter((story) => story.title === selectedStory?.title);
    if (siblingStories.length === 0) {
      return;
    }

    const selectedIndex = siblingStories.findIndex((story) => story.id === state.selectedStoryId);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      selectedIndex < 0
        ? direction > 0
          ? 0
          : siblingStories.length - 1
        : (selectedIndex + direction + siblingStories.length) % siblingStories.length;
    const nextStory = siblingStories[nextIndex];
    selectStory(nextStory);
    buttons.find((button) => button.dataset.galleryStoryButton === nextStory.id)?.focus();
  };

  const selectSubtree = (path: string) => {
    onStateChange({ ...state, contactSheet: true, selectedSubtree: path });
  };
  const toggleSubtree = (path: string, expanded: boolean) => {
    setExpandedSubtrees((current) => {
      const next = new Set(current);
      if (expanded) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-bg-primary tw-text-normal">
      <aside
        aria-label="Component and story navigation"
        className="copilot-gallery-divider-r tw-flex tw-w-64 tw-shrink-0 tw-flex-col tw-bg-secondary"
        onKeyDown={handleTreeKeyDown}
      >
        <header className="copilot-divider-b tw-flex tw-flex-col tw-gap-1 tw-p-3">
          <h1 className="tw-m-0 tw-text-ui-medium tw-font-semibold">Component gallery</h1>
          <p className="tw-m-0 tw-text-smallest tw-text-muted" data-gallery-coverage-summary>
            {catalog.componentCount} presentational components · {catalog.coveredCount} with stories
            · {catalog.componentCount - catalog.coveredCount} missing
          </p>
        </header>

        <div className="copilot-divider-b tw-p-3">
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
        </div>

        <nav aria-label="Story tree" className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-p-2">
          {storyTree.length > 0 ? (
            <StoryTree
              expandAll={filter.trim() !== ""}
              expandedSubtrees={expandedSubtrees}
              nodes={storyTree}
              onSelectStory={selectStory}
              onSelectSubtree={selectSubtree}
              onToggleSubtree={toggleSubtree}
              selectedStoryId={state.selectedStoryId}
              selectedStoryTitle={selectedStoryTitle}
              selectedSubtree={selectedSubtree}
              showContactSheet={state.contactSheet}
            />
          ) : (
            <p className="tw-m-2 tw-text-ui-smaller tw-text-muted">No matching stories.</p>
          )}
        </nav>
      </aside>

      <main className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-overflow-hidden">
        <header className="copilot-divider-b tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3 tw-p-4">
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
                {hostCardStories.length > 0 &&
                  ` · ${hostCardStories.length} non-leaf ${
                    hostCardStories.length === 1 ? "launcher" : "launchers"
                  }`}
              </p>
            )}
          </div>

          <div className="tw-flex tw-items-center tw-justify-end">
            <div
              aria-label="Story width"
              className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-1"
            >
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
              <CustomWidthControl
                onApply={(width) => onStateChange({ ...state, width })}
                width={state.width}
              />
            </div>
          </div>
        </header>

        <div
          className={cn(
            "tw-min-h-0 tw-flex-1 tw-overflow-auto",
            selectedStory?.layout === "fullscreen" && !state.contactSheet ? "tw-h-full" : "tw-p-4"
          )}
        >
          <div
            className={cn(
              "tw-flex tw-justify-center",
              selectedStory?.layout === "fullscreen" && !state.contactSheet
                ? "tw-h-full tw-min-w-0"
                : "tw-min-w-max"
            )}
          >
            <div
              className={cn(
                "copilot-gallery-canvas tw-flex tw-flex-col tw-gap-4",
                selectedStory?.layout === "fullscreen" && !state.contactSheet && "tw-h-full"
              )}
              data-gallery-width={state.width}
              style={{ width: state.width }}
            >
              {state.contactSheet ? (
                contactSheetStories.length > 0 || hostCardStories.length > 0 ? (
                  <>
                    {contactSheetStories.map((story) =>
                      renderLeafStory(story, true, state.width, ownerId)
                    )}
                    {hostCardStories.map((story) => renderHostCard(story, selectStory))}
                  </>
                ) : (
                  <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
                    This subtree has no stories.
                  </p>
                )
              ) : selectedStory ? (
                renderSelectedStory(
                  selectedStory,
                  state.width,
                  renderRevision,
                  ownerId,
                  onHostChange
                )
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
