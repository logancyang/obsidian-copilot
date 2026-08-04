import * as agentWelcomeStories from "@/agentMode/ui/AgentWelcomeCard.stories";
import * as galleryHostStories from "@/components/gallery-hosts.stories";
import * as badgeStories from "@/components/ui/badge.stories";
import * as buttonStories from "@/components/ui/button.stories";
import { AppContext } from "@/context";
import { act, fireEvent, render, within } from "@testing-library/react";
import type { App } from "obsidian";
import * as React from "react";
import {
  createGalleryCatalog,
  Gallery,
  type GalleryCatalog,
  type GalleryHostChange,
  type GalleryViewState,
  resolveGalleryViewState,
  type StoryDefinition,
} from "./Gallery";
import type { GalleryParameters, GalleryWidth, Host, Layout } from "@/lib/story";

jest.mock("@/components/modals/ReactModal", () => {
  const close = jest.fn();
  const open = jest.fn();

  return {
    ReactModal: class ReactModal {
      app: App;
      contentEl = activeDocument.createElement("div");
      title: string | undefined;

      constructor(app: App, title?: string) {
        this.app = app;
        this.title = title;
      }

      close(): void {
        close(this);
      }

      open(): void {
        open(this);
      }
    },
    galleryModalMock: { close, open },
  };
});

interface GalleryModalMock {
  close: jest.Mock;
  open: jest.Mock;
}

function getGalleryModalMock(): GalleryModalMock {
  const modalModule = jest.requireMock<{
    galleryModalMock: GalleryModalMock;
  }>("@/components/modals/ReactModal");
  return modalModule.galleryModalMock;
}

const GALLERY_APP = {} as App;

function makeStory(
  id: string,
  options: {
    host?: Host;
    layout?: Layout;
    name?: string;
    node?: React.ReactNode;
    width?: GalleryWidth;
  } = {}
): StoryDefinition {
  const segments = id.split("/");
  const exportName = segments.pop() ?? "Story";

  return {
    exportName,
    host: options.host ?? "leaf",
    id,
    layout: options.layout ?? "padded",
    name: options.name ?? exportName,
    render: () => options.node ?? <div>{`${id} content`}</div>,
    title: segments.join("/"),
    width: options.width,
  };
}

function makeCatalog(): GalleryCatalog {
  return {
    componentCount: 4,
    coveredCount: 4,
    stories: [
      makeStory("Agent Mode/Agent Welcome Card/Default", { layout: "fullscreen" }),
      makeStory("UI/Badge/Status", { layout: "centered" }),
      makeStory("UI/Button/Modal", { host: "modal" }),
      makeStory("UI/Button/Popover", { host: "popover" }),
      makeStory("UI/Button/Primary", {
        node: <button type="button">Primary example</button>,
      }),
      makeStory("UI/Setting Item/Preferences", {
        host: "settings-tab",
        node: <div>Settings example</div>,
      }),
    ],
  };
}

interface GalleryHarnessProps {
  catalog: GalleryCatalog;
  initialState?: Partial<GalleryViewState>;
  onHostChange?: GalleryHostChange;
}

function GalleryHarness({
  catalog,
  initialState,
  onHostChange,
}: GalleryHarnessProps): React.ReactElement {
  const [state, setState] = React.useState(() =>
    resolveGalleryViewState(initialState, catalog.stories)
  );
  return (
    <AppContext.Provider value={GALLERY_APP}>
      <Gallery
        catalog={catalog}
        onHostChange={onHostChange}
        onStateChange={setState}
        ownerId="test-gallery"
        state={state}
      />
    </AppContext.Provider>
  );
}

describe("Gallery", () => {
  beforeEach(() => {
    getGalleryModalMock().close.mockClear();
    getGalleryModalMock().open.mockClear();
  });

  describe("createGalleryCatalog()", () => {
    it("normalizes permanent component and host modules and renders their stories", () => {
      const catalog = createGalleryCatalog(
        [
          {
            componentId: "@/agentMode/ui/AgentWelcomeCard",
            storyModule: agentWelcomeStories,
          },
          { componentId: null, storyModule: galleryHostStories },
          { componentId: "@/components/ui/badge", storyModule: badgeStories },
          { componentId: "@/components/ui/button", storyModule: buttonStories },
        ],
        5
      );

      expect(catalog.componentCount).toBe(5);
      expect(catalog.coveredCount).toBe(3);
      expect(catalog.stories.map((story) => story.id)).toEqual([
        "Agent Mode/Agent Welcome Card/Default",
        "Agent Mode/Agent Welcome Card/Narrow",
        "Gallery/Host Environments/DefaultLeaf",
        "Gallery/Host Environments/DeleteConfirmation",
        "Gallery/Host Environments/ModelPreferences",
        "Gallery/Host Environments/ResponseActions",
        "UI/Badge/Status",
        "UI/Badge/Variants",
        "UI/Button/Disabled",
        "UI/Button/Sizes",
        "UI/Button/Variants",
      ]);
      expect(catalog.stories.find((story) => story.id.endsWith("/Narrow"))?.width).toBe(300);
      expect(
        catalog.stories.find((story) => story.id === "Gallery/Host Environments/DefaultLeaf")
      ).toMatchObject({ host: "leaf", layout: "fullscreen" });
      expect(
        catalog.stories.find((story) => story.id === "Gallery/Host Environments/DeleteConfirmation")
      ).toMatchObject({ host: "modal", layout: "padded" });
      expect(catalog.stories.find((story) => story.id === "UI/Badge/Status")?.layout).toBe(
        "centered"
      );

      const buttonSizes = catalog.stories.find((story) => story.id === "UI/Button/Sizes");
      const renderedSizes = render(<>{buttonSizes?.render()}</>);
      expect(renderedSizes.container.firstElementChild?.classList.contains("tw-flex-wrap")).toBe(
        true
      );
      renderedSizes.unmount();

      for (const story of catalog.stories) {
        const renderedStory = render(
          <AppContext.Provider value={GALLERY_APP}>{story.render()}</AppContext.Provider>
        );
        if (story.id.startsWith("Agent Mode/")) {
          fireEvent.click(renderedStory.getByRole("button", { name: "Dismiss" }));
          fireEvent.click(renderedStory.getByRole("button", { name: "New project" }));
        }
        renderedStory.unmount();
      }
    });

    it("uses story names and merged parameters while preserving coverage semantics", () => {
      const catalog = createGalleryCatalog(
        [
          {
            componentId: "@/components/ui/covered",
            storyModule: {
              default: {
                title: "UI/Covered",
                parameters: { gallery: { host: "modal", layout: "padded" } },
              },
              Example: {
                name: "Renamed example",
                parameters: { gallery: { host: "leaf", width: 340 } },
                render: () => "Covered story",
              },
            },
          },
          {
            componentId: "@/components/ui/opted-out",
            storyModule: {
              default: {
                title: "UI/OptedOut",
                parameters: { gallery: { coverage: false } },
              },
              Example: { render: () => "Opted-out story" },
            },
          },
          {
            componentId: null,
            storyModule: {
              default: { title: "Feature/Wired" },
              Example: { render: () => "Bonus story" },
            },
          },
          {
            componentId: "@/components/ui/empty",
            storyModule: {
              default: { title: "UI/Empty" },
            },
          },
        ],
        4
      );

      expect(catalog).toMatchObject({ componentCount: 3, coveredCount: 1 });
      expect(catalog.stories.find((story) => story.id === "UI/Covered/Example")).toMatchObject({
        host: "leaf",
        layout: "padded",
        name: "Renamed example",
        width: 340,
      });
    });

    it("renders hook-backed stories through React", () => {
      function HookStory(): React.ReactElement {
        const [label] = React.useState("Hook-backed story");
        return <span>{label}</span>;
      }

      const catalog = createGalleryCatalog(
        [
          {
            componentId: null,
            storyModule: {
              default: { title: "UI/HookStory" },
              Example: { render: HookStory },
            },
          },
        ],
        0
      );

      const story = render(<>{catalog.stories[0].render()}</>);
      expect(story.getByText("Hook-backed story")).toBeTruthy();
      story.unmount();
    });

    it("rejects unsupported story widths at compile time", () => {
      const parameters: GalleryParameters = {
        gallery: {
          // @ts-expect-error The gallery offers only its declared viewport presets to stories.
          width: 500,
        },
      };

      expect(parameters.gallery?.width).toBe(500);
    });

    it("rejects a story without a render function or meta component", () => {
      expect(() =>
        createGalleryCatalog(
          [
            {
              componentId: "@/components/ui/missing-component",
              storyModule: {
                default: { title: "UI/MissingComponent" },
                Broken: {},
              },
            },
          ],
          1
        )
      ).toThrow('Story "UI/MissingComponent/Broken" must define render or meta.component');
    });
  });

  describe("resolveGalleryViewState()", () => {
    it("restores valid identities and gallery widths", () => {
      const stories = [
        makeStory("UI/Button/Default"),
        makeStory("UI/Button/Narrow", { width: 340 }),
      ];

      expect(
        resolveGalleryViewState(
          {
            contactSheet: true,
            selectedStoryId: "UI/Button/Narrow",
            selectedSubtree: "UI",
            width: 600,
          },
          stories
        )
      ).toEqual({
        contactSheet: true,
        selectedStoryId: "UI/Button/Narrow",
        selectedSubtree: "UI",
        width: 600,
      });
    });

    it("falls back to an available story, its metadata width, and its title", () => {
      const stories = [makeStory("UI/Button/Narrow", { width: 340 })];

      expect(
        resolveGalleryViewState(
          {
            contactSheet: "yes",
            selectedStoryId: "Missing/Story",
            selectedSubtree: "Missing",
            width: -1,
          },
          stories
        )
      ).toEqual({
        contactSheet: false,
        selectedStoryId: "UI/Button/Narrow",
        selectedSubtree: "UI/Button",
        width: 340,
      });
    });

    it("preserves unresolved identities until dynamic story modules load", () => {
      expect(
        resolveGalleryViewState(
          {
            selectedStoryId: "UI/Button/Sizes",
            selectedSubtree: "UI/Button",
            width: 300,
          },
          []
        )
      ).toEqual({
        contactSheet: false,
        selectedStoryId: "UI/Button/Sizes",
        selectedSubtree: "UI/Button",
        width: 300,
      });
    });
  });

  describe("Gallery()", () => {
    it("visibly exposes nested components, story switches, selected styling, and the current id", () => {
      const gallery = render(<GalleryHarness catalog={makeCatalog()} />);
      const navigation = gallery.getByRole("complementary", {
        name: "Component and story navigation",
      });

      expect(
        within(navigation).getByRole("button", { name: "Show Agent Mode contact sheet" })
      ).toBeTruthy();
      expect(
        within(navigation).getByRole("button", { name: "Show UI contact sheet" })
      ).toBeTruthy();
      const selectedStoryButton = within(navigation).getByRole("button", {
        name: "Default Selected",
      });
      expect(selectedStoryButton.getAttribute("aria-current")).toBe("true");
      expect(selectedStoryButton.classList.contains("mod-cta")).toBe(true);

      const unselectedStoryButton = within(navigation).getByRole("button", { name: "Status" });
      expect(unselectedStoryButton.classList.contains("clickable-icon")).toBe(true);
      expect(unselectedStoryButton.classList.contains("tw-bg-transparent")).toBe(true);
      expect(unselectedStoryButton.classList.contains("mod-cta")).toBe(false);
      expect(gallery.getByText("Agent Mode/Agent Welcome Card/Default")).toBeTruthy();
      expect(gallery.container.querySelectorAll("[data-gallery-story-id]")).toHaveLength(1);
      expect(
        gallery.container.querySelector(
          '[data-story="Agent Mode/Agent Welcome Card/Default"][data-story-width="400"]'
        )
      ).toBeTruthy();
      expect(
        gallery.getByText("Switch themes in Obsidian settings; the gallery follows.")
      ).toBeTruthy();
    });

    it("filters by component title or story name and restores the tree when cleared", () => {
      const gallery = render(<GalleryHarness catalog={makeCatalog()} />);
      const filter = gallery.getByRole("searchbox", {
        name: "Filter components and stories",
      });

      fireEvent.change(filter, { target: { value: "Badge" } });
      expect(gallery.getByRole("button", { name: "Status" })).toBeTruthy();
      expect(gallery.queryByRole("button", { name: "Primary" })).toBeNull();

      fireEvent.change(filter, { target: { value: "Primary" } });
      expect(gallery.getByRole("button", { name: "Primary" })).toBeTruthy();
      expect(gallery.queryByRole("button", { name: "Status" })).toBeNull();

      fireEvent.change(filter, { target: { value: "" } });
      expect(gallery.getByRole("button", { name: "Status" })).toBeTruthy();
      expect(gallery.getByRole("button", { name: "Primary" })).toBeTruthy();
    });

    it("switches rendered stories with mouse clicks and keeps arrow keys among siblings", () => {
      const gallery = render(<GalleryHarness catalog={makeCatalog()} />);

      fireEvent.click(gallery.getByRole("button", { name: "Status" }));
      expect(gallery.getByText("UI/Badge/Status")).toBeTruthy();
      expect(gallery.container.querySelectorAll("[data-gallery-story-id]")).toHaveLength(1);

      const statusButton = gallery.getByRole("button", { name: "Status Selected" });
      statusButton.focus();
      fireEvent.keyDown(statusButton, { key: "ArrowDown" });
      expect(gallery.getByText("UI/Badge/Status")).toBeTruthy();

      fireEvent.click(gallery.getByRole("button", { name: "Primary" }));
      fireEvent.keyDown(gallery.getByRole("button", { name: "Primary Selected" }), {
        key: "ArrowUp",
      });
      expect(gallery.getByText("UI/Button/Popover")).toBeTruthy();
    });

    it("renders leaf stories and non-leaf launch cards in a selected contact sheet", () => {
      const gallery = render(<GalleryHarness catalog={makeCatalog()} />);

      fireEvent.click(gallery.getByRole("button", { name: "Show UI contact sheet" }));

      expect(
        gallery.getByRole("button", { name: "Show UI contact sheet" }).classList.contains("mod-cta")
      ).toBe(true);
      expect(gallery.getByText("Current subtree")).toBeTruthy();
      expect(gallery.getByText("2 leaf stories · 3 non-leaf launchers")).toBeTruthy();
      expect(
        gallery.container.querySelector('[data-gallery-story-id="UI/Badge/Status"]')
      ).toBeTruthy();
      expect(
        gallery.container.querySelector('[data-gallery-story-id="UI/Button/Primary"]')
      ).toBeTruthy();
      expect(
        gallery.container.querySelector('[data-gallery-story-id="UI/Button/Modal"]')
      ).toBeNull();
      expect(gallery.container.querySelectorAll("[data-gallery-host-card]")).toHaveLength(3);

      fireEvent.click(gallery.getByRole("button", { name: "Open modal story" }));
      expect(getGalleryModalMock().open).toHaveBeenCalledTimes(1);
      expect(gallery.getByText("UI/Button/Modal")).toBeTruthy();
      expect(gallery.getByRole("button", { name: "Modal Selected" })).toBeTruthy();

      fireEvent.click(gallery.getByRole("button", { name: "Show UI contact sheet" }));

      fireEvent.click(gallery.getByRole("button", { name: "Show selected story" }));
      expect(gallery.getByText("UI/Button/Modal")).toBeTruthy();
      expect(gallery.container.querySelectorAll("[data-gallery-story-id]")).toHaveLength(1);
    });

    it("allows contact sheet headings and long exact story ids to wrap", () => {
      const storyId = "Agent Mode/Agent Status Card/IncompatibleWarning";
      const catalog = {
        componentCount: 1,
        coveredCount: 1,
        stories: [makeStory(storyId)],
      };
      const gallery = render(
        <GalleryHarness
          catalog={catalog}
          initialState={{
            contactSheet: true,
            selectedStoryId: storyId,
            selectedSubtree: "Agent Mode/Agent Status Card",
            width: 300,
          }}
        />
      );
      const story = gallery.container.querySelector(`[data-gallery-story-id="${storyId}"]`);
      const header = story?.querySelector("header");
      const heading = header?.querySelector("h3");
      const exactId = header?.querySelector("code");

      expect(heading?.textContent).toBe("IncompatibleWarning");
      expect(heading?.classList.contains("tw-min-w-0")).toBe(true);
      expect(heading?.classList.contains("tw-break-words")).toBe(true);
      expect(exactId?.textContent).toBe(storyId);
      expect(exactId?.classList.contains("tw-min-w-0")).toBe(true);
      expect(exactId?.classList.contains("tw-break-all")).toBe(true);
      expect(exactId?.classList.contains("tw-text-right")).toBe(true);
    });

    it("opens a selected modal once until the user selects away and back", () => {
      const onHostChange = jest.fn<void, Parameters<GalleryHostChange>>();
      const gallery = render(
        <GalleryHarness catalog={makeCatalog()} onHostChange={onHostChange} />
      );

      fireEvent.click(gallery.getByRole("button", { name: "Modal" }));
      expect(getGalleryModalMock().open).toHaveBeenCalledTimes(1);
      expect(gallery.queryByText("UI/Button/Modal content")).toBeNull();
      expect(gallery.getByRole("button", { name: "Reopen modal story" })).toBeTruthy();

      const closeModal = onHostChange.mock.calls.find(
        ([storyId, close]) => storyId === "UI/Button/Modal" && close
      )?.[1];
      closeModal?.();
      expect(getGalleryModalMock().close).toHaveBeenCalled();
      fireEvent.click(gallery.getByRole("button", { name: "300" }));
      expect(getGalleryModalMock().open).toHaveBeenCalledTimes(1);
      expect(gallery.getByRole("button", { name: "Modal Selected" })).toBeTruthy();

      fireEvent.click(gallery.getByRole("button", { name: "Primary" }));
      fireEvent.click(gallery.getByRole("button", { name: "Modal" }));
      expect(getGalleryModalMock().open).toHaveBeenCalledTimes(2);
    });

    it("renders modal-hosted hook stories inside React's lifecycle", () => {
      function HookStory(): React.ReactElement {
        const [label] = React.useState("Hook-backed modal");
        return <span>{label}</span>;
      }

      const catalog = createGalleryCatalog(
        [
          {
            componentId: null,
            storyModule: {
              default: {
                title: "UI/ModalHooks",
                parameters: { gallery: { host: "modal" } },
              },
              Example: { render: HookStory },
            },
          },
        ],
        0
      );
      const gallery = render(<GalleryHarness catalog={catalog} />);
      const modal = getGalleryModalMock().open.mock.calls[0][0] as unknown as {
        renderContent(): React.ReactElement;
      };

      const modalContent = render(modal.renderContent());
      expect(modalContent.getByText("Hook-backed modal")).toBeTruthy();

      modalContent.unmount();
      gallery.unmount();
    });

    it("places stable story and width selectors on every actual host case", () => {
      const gallery = render(<GalleryHarness catalog={makeCatalog()} />);

      fireEvent.click(gallery.getByRole("button", { name: "Modal" }));
      const modal = getGalleryModalMock().open.mock.calls[0][0] as {
        renderContent(): React.ReactElement;
      };
      const modalContent = render(modal.renderContent());
      const modalStory = modalContent.container.querySelector<HTMLElement>(
        '[data-story="UI/Button/Modal"][data-story-width="400"]'
      );
      expect(modalStory?.dataset.galleryOwner).toBe("test-gallery");
      expect(modalStory?.style.width).toBe("400px");
      modalContent.unmount();

      fireEvent.click(gallery.getByRole("button", { name: "Popover" }));
      const popoverStory = activeDocument.body.querySelector<HTMLElement>(
        '[data-gallery-host="popover"][data-story="UI/Button/Popover"][data-story-width="400"]'
      );
      expect(popoverStory?.dataset.galleryOwner).toBe("test-gallery");
      expect(popoverStory?.style.width).toBe("400px");

      fireEvent.click(gallery.getByRole("button", { name: "Preferences" }));
      expect(
        gallery.container.querySelector(
          '[data-gallery-host="settings-tab"][data-story="UI/Setting Item/Preferences"][data-story-width="400"]'
        )
      ).toBeTruthy();
    });

    it("contains a throwing story and recovers when another keyed story is selected", () => {
      const renderError = jest.spyOn(console, "error").mockImplementation(() => undefined);
      const catalog: GalleryCatalog = {
        componentCount: 1,
        coveredCount: 1,
        stories: [
          makeStory("UI/Test/Broken", {
            node: undefined,
          }),
          makeStory("UI/Test/Healthy"),
        ],
      };
      catalog.stories[0].render = () => {
        throw new Error("boom");
      };

      const gallery = render(<GalleryHarness catalog={catalog} />);

      expect(
        gallery.container.querySelector(
          '[data-story="UI/Test/Broken"] [data-story-render-error="boom"]'
        )
      ).toBeTruthy();
      fireEvent.click(gallery.getByRole("button", { name: "Healthy" }));
      expect(gallery.getByText("UI/Test/Healthy content")).toBeTruthy();
      expect(gallery.container.querySelector("[data-story-render-error]")).toBeNull();

      renderError.mockRestore();
    });

    it("anchors a real popover to the selected story trigger", () => {
      const onHostChange = jest.fn<void, Parameters<GalleryHostChange>>();
      const gallery = render(
        <GalleryHarness catalog={makeCatalog()} onHostChange={onHostChange} />
      );

      fireEvent.click(gallery.getByRole("button", { name: "Popover" }));

      const trigger = gallery.getByRole("button", { name: "Toggle popover story" });
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(gallery.getByText("UI/Button/Popover content")).toBeTruthy();
      expect(
        activeDocument.body.querySelector(
          '[data-gallery-host-content][data-gallery-host="popover"]'
        )
      ).toBeTruthy();

      const closePopover = onHostChange.mock.calls.find(
        ([storyId, close]) => storyId === "UI/Button/Popover" && close
      )?.[1];
      act(() => closePopover?.());
      expect(
        activeDocument.body.querySelector(
          '[data-gallery-host-content][data-gallery-host="popover"]'
        )
      ).toBeNull();
    });

    it("renders settings stories under native settings-tab ancestry", () => {
      const onHostChange = jest.fn<void, Parameters<GalleryHostChange>>();
      const gallery = render(
        <GalleryHarness catalog={makeCatalog()} onHostChange={onHostChange} />
      );

      fireEvent.click(gallery.getByRole("button", { name: "Preferences" }));

      expect(gallery.getByText("Settings example")).toBeTruthy();
      expect(
        gallery.container.querySelector(
          ".modal.mod-settings .modal-content .vertical-tabs .vertical-tab-content-container .vertical-tab-content"
        )
      ).toBeTruthy();

      const closeSettings = onHostChange.mock.calls.find(
        ([storyId, close]) => storyId === "UI/Setting Item/Preferences" && close
      )?.[1];
      act(() => closeSettings?.());
      expect(gallery.queryByText("Settings example")).toBeNull();
    });

    it("selects exact width attributes and applies padded, centered, and fullscreen layouts", () => {
      const gallery = render(<GalleryHarness catalog={makeCatalog()} />);
      const canvas = gallery.container.querySelector<HTMLElement>(".copilot-gallery-canvas");

      expect(canvas?.dataset.galleryWidth).toBe("400");
      fireEvent.click(gallery.getByRole("button", { name: "300" }));
      expect(canvas?.dataset.galleryWidth).toBe("300");
      expect(canvas?.style.width).toBe("300px");
      expect(gallery.getByText("Current width:").parentElement?.textContent).toContain("300px");

      const fullscreenContent = gallery.container.querySelector<HTMLElement>(
        '[data-gallery-story-id="Agent Mode/Agent Welcome Card/Default"] > div'
      );
      const fullscreenStory = fullscreenContent?.parentElement;
      expect(fullscreenContent?.classList.contains("tw-size-full")).toBe(true);
      expect(fullscreenContent?.classList.contains("tw-p-4")).toBe(false);
      expect(fullscreenStory?.classList.contains("tw-h-full")).toBe(true);
      expect(canvas?.classList.contains("tw-h-full")).toBe(true);
      expect(canvas?.parentElement?.parentElement?.classList.contains("tw-p-4")).toBe(false);

      fireEvent.click(gallery.getByRole("button", { name: "Status" }));
      const centeredContent = gallery.container.querySelector<HTMLElement>(
        '[data-gallery-story-id="UI/Badge/Status"] > div'
      );
      expect(centeredContent?.classList.contains("tw-items-center")).toBe(true);
      expect(centeredContent?.classList.contains("tw-justify-center")).toBe(true);
      expect(centeredContent?.classList.contains("tw-p-4")).toBe(true);

      fireEvent.click(gallery.getByRole("button", { name: "Primary" }));
      const paddedContent = gallery.container.querySelector<HTMLElement>(
        '[data-gallery-story-id="UI/Button/Primary"] > div'
      );
      expect(paddedContent?.classList.contains("tw-rounded-md")).toBe(true);
      expect(paddedContent?.classList.contains("tw-border")).toBe(true);
      expect(paddedContent?.classList.contains("tw-p-4")).toBe(true);
    });

    it("uses a positive external width without adding another width control", () => {
      const gallery = render(
        <GalleryHarness catalog={makeCatalog()} initialState={{ width: 512 }} />
      );
      const canvas = gallery.container.querySelector<HTMLElement>(".copilot-gallery-canvas");

      expect(canvas?.dataset.galleryWidth).toBe("512");
      expect(canvas?.style.width).toBe("512px");
      expect(gallery.getAllByRole("button", { name: /^(300|340|400|600)$/ })).toHaveLength(4);
      expect(gallery.container.querySelector('[data-story-width="512"]')).toBeTruthy();
    });
  });
});
