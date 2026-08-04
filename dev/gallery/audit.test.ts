import { getGalleryTheme, inspectStoryCase, resolveObsidianColorTokens } from "./audit";

/* eslint-disable obsidianmd/no-static-styles-assignment -- Exact computed-color fixtures are the behavior under test. */

function setDimensions(
  element: HTMLElement,
  dimensions: { clientWidth: number; height: number; scrollWidth: number; width: number }
): void {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: dimensions.clientWidth },
    scrollWidth: { configurable: true, value: dimensions.scrollWidth },
  });
  element.getBoundingClientRect = () => ({
    bottom: dimensions.height,
    height: dimensions.height,
    left: 0,
    right: dimensions.width,
    top: 0,
    width: dimensions.width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

describe("audit", () => {
  describe("resolveObsidianColorTokens()", () => {
    it("resolves direct and aliased color variables while excluding non-color values", () => {
      activeDocument.documentElement.style.setProperty("--color-base-00", "#ffffff");
      activeDocument.body.style.setProperty("--background-primary", "var(--color-base-00)");
      activeDocument.body.style.setProperty("--text-normal", "rgb(0, 0, 0)");
      activeDocument.body.style.setProperty("--border-width", "4px");

      const colors = resolveObsidianColorTokens(activeDocument);

      expect(colors).toEqual(new Set(["255,255,255,1.000", "0,0,0,1.000"]));
    });
  });

  describe("inspectStoryCase()", () => {
    it("reports overflow, zero size, render errors, low contrast, and literal colors", () => {
      const story = activeDocument.createElement("div");
      story.dataset.story = "UI/Test/Broken";
      story.dataset.storyRenderError = "boom";
      story.style.backgroundColor = "rgb(255, 255, 255)";
      story.style.color = "rgb(153, 153, 153)";
      story.textContent = "Low contrast";
      activeDocument.body.append(story);
      setDimensions(story, { clientWidth: 300, height: 0, scrollWidth: 412, width: 300 });

      const findings = inspectStoryCase(story, new Set(["255,255,255,1.000"]));

      expect(findings).toEqual(
        expect.arrayContaining([
          {
            story: "UI/Test/Broken",
            check: "overflow",
            detail: "scrollWidth 412 > clientWidth 300",
          },
          {
            story: "UI/Test/Broken",
            check: "zero-size",
            detail: "width 300 x height 0",
          },
          { story: "UI/Test/Broken", check: "render-failure", detail: "boom" },
          expect.objectContaining({ story: "UI/Test/Broken", check: "contrast" }),
          expect.objectContaining({ story: "UI/Test/Broken", check: "off-token-color" }),
        ])
      );
    });

    it("accepts token-backed colors with AA contrast and a nonzero fitting box", () => {
      const story = activeDocument.createElement("div");
      story.dataset.story = "UI/Test/Healthy";
      story.style.backgroundColor = "rgb(255, 255, 255)";
      story.style.color = "rgb(0, 0, 0)";
      const transparentChild = activeDocument.createElement("span");
      transparentChild.style.backgroundColor = "rgba(0, 0, 0, 0)";
      transparentChild.style.color = "rgb(0, 0, 0)";
      transparentChild.textContent = "Readable";
      story.append(transparentChild);
      activeDocument.body.append(story);
      setDimensions(story, { clientWidth: 300, height: 40, scrollWidth: 300, width: 300 });

      expect(inspectStoryCase(story, new Set(["255,255,255,1.000", "0,0,0,1.000"]))).toEqual([]);
    });
  });

  describe("getGalleryTheme()", () => {
    it("reports default and configured community themes without mutating the mode", () => {
      activeDocument.body.classList.add("theme-dark");

      expect(getGalleryTheme(activeDocument)).toBe("obsidian-dark");
      expect(getGalleryTheme(activeDocument, "Things")).toBe("Things-dark");
      expect(activeDocument.body.classList.contains("theme-dark")).toBe(true);
    });
  });
});
