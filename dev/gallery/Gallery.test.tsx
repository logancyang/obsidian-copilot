import * as agentWelcomeStories from "@/agentMode/ui/AgentWelcomeCard.stories";
import * as badgeStories from "@/components/ui/badge.stories";
import * as buttonStories from "@/components/ui/button.stories";
import { fireEvent, render, within } from "@testing-library/react";
import * as React from "react";
import {
  createGalleryCatalog,
  Gallery,
  type GalleryCatalog,
  type GalleryViewState,
  resolveGalleryViewState,
  type StoryDefinition,
} from "./Gallery";
import type { Host, Layout } from "@/lib/story";

function makeStory(
  id: string,
  options: {
    host?: Host;
    layout?: Layout;
    name?: string;
    node?: React.ReactNode;
    width?: number;
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
      makeStory("UI/Button/Primary", {
        node: <button type="button">Primary example</button>,
      }),
    ],
  };
}

interface GalleryHarnessProps {
  catalog: GalleryCatalog;
  initialState?: Partial<GalleryViewState>;
}

function GalleryHarness({ catalog, initialState }: GalleryHarnessProps): React.ReactElement {
  const [state, setState] = React.useState(() =>
    resolveGalleryViewState(initialState, catalog.stories)
  );
  return <Gallery catalog={catalog} onStateChange={setState} state={state} />;
}

describe("Gallery", () => {
  describe("createGalleryCatalog()", () => {
    it("normalizes three real component modules across two ui roots and renders their stories", () => {
      const catalog = createGalleryCatalog(
        [
          {
            componentId: "@/agentMode/ui/AgentWelcomeCard",
            storyModule: agentWelcomeStories,
          },
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
        "UI/Badge/Status",
        "UI/Badge/Variants",
        "UI/Button/Disabled",
        "UI/Button/Sizes",
        "UI/Button/Variants",
      ]);
      expect(catalog.stories.find((story) => story.id.endsWith("/Narrow"))?.width).toBe(300);
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
        const renderedStory = render(<>{story.render()}</>);
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
        ],
        3
      );

      expect(catalog).toMatchObject({ componentCount: 2, coveredCount: 1 });
      expect(catalog.stories.find((story) => story.id === "UI/Covered/Example")).toMatchObject({
        host: "leaf",
        layout: "padded",
        name: "Renamed example",
        width: 340,
      });
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
            width: 999,
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

    it("switches one rendered story with mouse clicks and up/down arrow keys", () => {
      const gallery = render(<GalleryHarness catalog={makeCatalog()} />);

      fireEvent.click(gallery.getByRole("button", { name: "Status" }));
      expect(gallery.getByText("UI/Badge/Status")).toBeTruthy();
      expect(gallery.container.querySelectorAll("[data-gallery-story-id]")).toHaveLength(1);

      const statusButton = gallery.getByRole("button", { name: "Status Selected" });
      statusButton.focus();
      fireEvent.keyDown(statusButton, { key: "ArrowDown" });
      expect(gallery.getByText("UI/Button/Modal")).toBeTruthy();

      fireEvent.keyDown(gallery.getByRole("button", { name: "Modal Selected" }), {
        key: "ArrowUp",
      });
      expect(gallery.getByText("UI/Badge/Status")).toBeTruthy();
    });

    it("renders a selected title subtree as a leaf-only contact sheet", () => {
      const gallery = render(<GalleryHarness catalog={makeCatalog()} />);

      fireEvent.click(gallery.getByRole("button", { name: "Show UI contact sheet" }));

      expect(
        gallery.getByRole("button", { name: "Show UI contact sheet" }).classList.contains("mod-cta")
      ).toBe(true);
      expect(gallery.getByText("Current subtree")).toBeTruthy();
      expect(gallery.getByText("2 leaf stories · 1 non-leaf skipped")).toBeTruthy();
      expect(
        gallery.container.querySelector('[data-gallery-story-id="UI/Badge/Status"]')
      ).toBeTruthy();
      expect(
        gallery.container.querySelector('[data-gallery-story-id="UI/Button/Primary"]')
      ).toBeTruthy();
      expect(
        gallery.container.querySelector('[data-gallery-story-id="UI/Button/Modal"]')
      ).toBeNull();

      fireEvent.click(gallery.getByRole("button", { name: "Show selected story" }));
      expect(gallery.getByText("Agent Mode/Agent Welcome Card/Default")).toBeTruthy();
      expect(gallery.container.querySelectorAll("[data-gallery-story-id]")).toHaveLength(1);
    });

    it("selects exact width attributes and applies padded, centered, and fullscreen layouts", () => {
      const gallery = render(<GalleryHarness catalog={makeCatalog()} />);
      const canvas = gallery.container.querySelector<HTMLElement>(".copilot-gallery-canvas");

      expect(canvas?.dataset.galleryWidth).toBe("400");
      fireEvent.click(gallery.getByRole("button", { name: "300" }));
      expect(canvas?.dataset.galleryWidth).toBe("300");
      expect(gallery.getByText("Current width:").parentElement?.textContent).toContain("300px");

      const fullscreenContent = gallery.container.querySelector<HTMLElement>(
        '[data-gallery-story-id="Agent Mode/Agent Welcome Card/Default"] > div'
      );
      expect(fullscreenContent?.classList.contains("tw-w-full")).toBe(true);
      expect(fullscreenContent?.classList.contains("tw-p-4")).toBe(false);

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
  });
});
