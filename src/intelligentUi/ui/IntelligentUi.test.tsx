import { AppContext } from "@/context";
import { IntelligentUi } from "@/intelligentUi/ui/IntelligentUi";
import { parseIntelligentUi, UiNode } from "@/intelligentUi/parser";
import { GOLDEN_EXAMPLES } from "@/intelligentUi/testing/golden";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { App, Component, setIcon } from "obsidian";
import React from "react";

jest.mock("@/utils/renderMarkdown", () => ({ renderMarkdown: jest.fn() }));
jest.mock("obsidian", () => ({
  ...jest.requireActual<typeof import("obsidian")>("obsidian"),
  setIcon: jest.fn((element: HTMLElement, name: string) => element.setAttribute("data-icon", name)),
}));
const app = {} as App;
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/881";
const mount = (source: string) =>
  render(
    <AppContext.Provider value={app}>
      <IntelligentUi result={parseIntelligentUi(source)} source={source} sourcePath="Topic.md" />
    </AppContext.Provider>
  );

describe("IntelligentUi", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(renderMarkdown).mockImplementation(async (_app, text, el) => {
      el.textContent = text;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  describe("IntelligentUi()", () => {
    it.each(Object.entries(GOLDEN_EXAMPLES))(
      "renders the %s golden example in source order",
      async (_name, source) => {
        const { container } = mount(source);
        await act(async () => {
          await Promise.allSettled(
            jest.mocked(renderMarkdown).mock.results.map((result) => result.value as Promise<void>)
          );
        });
        const parsed = parseIntelligentUi(source);
        if (parsed.status === "error") throw new Error("Invalid fixture");
        const texts = (nodes: readonly UiNode[]): string[] =>
          nodes
            .flatMap((node) => [
              String(node.props.title ?? ""),
              String(node.props.label ?? ""),
              String(node.props.value ?? ""),
              String(node.props.delta ?? ""),
              node.text,
              ...texts(node.children),
            ])
            .filter(Boolean);
        let offset = 0;
        for (const text of texts(parsed.nodes)) {
          const found = container.textContent!.indexOf(text, offset);
          expect(found).toBeGreaterThanOrEqual(offset);
          offset = found + text.length;
        }
      }
    );

    it(`renders all primitives with role-based headings, lists and separators that note styles cannot restyle (${ISSUE})`, async () => {
      const { container } = mount(
        '<stack><heading>Overview</heading><panel><grid columns="3"><card title="Plan" icon="list"><text>Read</text><badge>Ready</badge><divider/><icon name="check"/></card></grid><row><metric value="42" label="Notes" delta="+3"/></row><steps><step title="First" icon="search">Collect</step><step><text>Connect</text></step></steps></panel></stack>'
      );
      await act(async () => {
        await Promise.allSettled(
          jest.mocked(renderMarkdown).mock.results.map((result) => result.value as Promise<void>)
        );
      });
      expect(screen.getByRole("heading", { name: "Overview", level: 2 })).toBeTruthy();
      expect(screen.getByRole("region", { name: "Plan" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Plan", level: 3 })).toBeTruthy();
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
      expect(screen.getByRole("separator")).toBeTruthy();
      expect(screen.getByText("+3").className).toContain("tw-text-muted");
      expect(container.querySelector('[data-icon="check"]')).toBeTruthy();
      expect(setIcon).toHaveBeenCalledWith(expect.any(HTMLElement), "list");
      expect(screen.getByText("Ready")).toBeTruthy();
      expect(container.querySelector("h1, h2, h3, h4, h5, h6, p, ol, ul, li, hr")).toBeNull();
    });

    it("numbers steps unless an icon replaces the number, and shrinks headings inside boxes", () => {
      const { container } = mount(
        '<steps><step title="Collect">Read</step><step title="Link" icon="link">Connect</step></steps><card title="Plan" description="This week"><heading>Inside</heading></card>'
      );
      const markers = [...container.querySelectorAll("[role=listitem] > [aria-hidden]")];
      expect(markers.map((marker) => marker.firstElementChild?.textContent)).toEqual(["1", ""]);
      expect(markers[1].querySelector('[data-icon="link"]')).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Inside", level: 4 })).toBeTruthy();
      expect(screen.getByText("This week")).toBeTruthy();
    });

    it(`marks signed metric changes with a trend icon and leaves unsigned ones plain (${ISSUE})`, () => {
      const { container } = mount(
        '<row><metric value="42" label="Notes" delta="+3"/><metric value="8" label="Bugs" delta="-2"/><metric value="1" label="Ties" delta="same"/></row>'
      );
      expect(
        [...container.querySelectorAll("[data-icon]")].map((icon) => icon.getAttribute("data-icon"))
      ).toEqual(["trending-up", "trending-down"]);
      expect(screen.getByText("same")).toBeTruthy();
    });

    it(`turns row arrows downward when the row stacks and draws row dividers vertically (${ISSUE})`, () => {
      const { container } = mount(
        '<row><card title="In"/><icon name="arrow-right"/><divider/><card title="Out"/></row>'
      );
      expect(
        container.querySelector('[data-icon="arrow-right"]')?.parentElement?.className
      ).toContain("tw-rotate-90");
      expect(screen.getByRole("separator").className).toContain("@lg:tw-w-px");
    });

    it(`labels callouts with their title or tone and uses the theme's callout icon (${ISSUE})`, () => {
      jest.spyOn(window, "getComputedStyle").mockReturnValue({
        getPropertyValue: () => " lucide-flame ",
      } as unknown as CSSStyleDeclaration);
      const { container } = mount(
        '<callout tone="tip"><text>Link notes.</text></callout><callout title="Heads up"><text>Back up.</text></callout>'
      );
      const callouts = [...container.querySelectorAll(".callout")];
      expect(callouts.map((callout) => callout.getAttribute("data-callout"))).toEqual([
        "tip",
        "note",
      ]);
      expect(
        callouts.map((callout) => callout.querySelector(".callout-title-inner")?.textContent)
      ).toEqual(["Tip", "Heads up"]);
      expect(callouts[0].querySelector('.callout-icon[data-icon="lucide-flame"]')).toBeTruthy();
    });

    it("shows the first tab and switches panels by click or arrow keys", () => {
      mount(
        '<tabs><tab title="macOS"><text>Open Finder.</text></tab><tab title="Windows"><text>Open Explorer.</text></tab></tabs>'
      );
      const [mac, windows] = screen.getAllByRole("tab");
      expect(mac.getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("tabpanel").textContent).toBe("Open Finder.");
      fireEvent.click(windows);
      expect(screen.getByRole("tabpanel").textContent).toBe("Open Explorer.");
      fireEvent.keyDown(windows, { key: "ArrowRight" });
      expect(mac.getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(mac);
      fireEvent.keyDown(mac, { key: "ArrowLeft" });
      expect(screen.getByRole("tabpanel").textContent).toBe("Open Explorer.");
    });

    it("renders text and attribute markup literally without creating HTML", () => {
      const source =
        '<card title="<img src=x onerror=alert(1)>"><text>**bold** & plain</text><badge>**safe**</badge></card>';
      const { container } = mount(source);
      expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
      expect(screen.getByText("**bold** & plain")).toBeTruthy();
      expect(container.querySelector("img, strong, script")).toBeNull();
    });

    it(`preserves every character of rejected source after a short notice (${ISSUE})`, () => {
      const source = '\n<script>alert("unsafe")</script>\n```\n<card title="Lost">\n';
      const { container } = mount(source);
      expect(screen.getByRole("status").textContent).toBe(
        "This layout could not be displayed. Original source:"
      );
      expect(container.querySelector("pre code")?.textContent).toBe(source);
      expect(container.querySelector("script")).toBeNull();
    });

    it("passes Markdown links and wikilinks to the existing renderer with the supplied vault context", async () => {
      mount("<markdown>Read [[Research]] and [guide](https://example.com).</markdown>");
      await act(async () => {
        await Promise.allSettled(
          jest.mocked(renderMarkdown).mock.results.map((result) => result.value as Promise<void>)
        );
      });
      expect(renderMarkdown).toHaveBeenCalledWith(
        app,
        "Read [[Research]] and [guide](https://example.com).",
        expect.any(HTMLElement),
        "Topic.md",
        expect.any(Component)
      );
      expect(screen.getByText("Read [[Research]] and [guide](https://example.com).")).toBeTruthy();
    });

    it(`keeps Markdown literal when rendering fails (${ISSUE})`, async () => {
      jest.mocked(renderMarkdown).mockRejectedValueOnce(new Error("renderer unavailable"));
      mount("<markdown>[[Keep this]]</markdown>");
      await act(async () => {
        await Promise.allSettled(
          jest.mocked(renderMarkdown).mock.results.map((result) => result.value as Promise<void>)
        );
      });
      expect(screen.getByText("[[Keep this]]")).toBeTruthy();
    });

    it(`discards stale Markdown work and unloads its resources when source changes (${ISSUE})`, async () => {
      let finish!: () => void;
      jest.mocked(renderMarkdown).mockImplementationOnce(
        (_app, _text, el) =>
          new Promise<void>((resolve) => {
            finish = () => {
              el.textContent = "old";
              resolve();
            };
          })
      );
      const unload = jest.spyOn(Component.prototype, "unload");
      const { rerender } = mount("<markdown>old</markdown>");
      rerender(
        <AppContext.Provider value={app}>
          <IntelligentUi
            result={parseIntelligentUi("<markdown>new</markdown>")}
            source="new"
            sourcePath="Topic.md"
          />
        </AppContext.Provider>
      );
      expect(unload).not.toHaveBeenCalled();
      await act(async () => {
        finish();
      });
      expect(screen.getByText("new")).toBeTruthy();
      expect(screen.queryByText("old")).toBeNull();
      expect(unload).toHaveBeenCalledTimes(1);
    });
  });
});
