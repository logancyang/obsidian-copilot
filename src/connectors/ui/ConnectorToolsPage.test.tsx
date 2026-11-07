import type { ServiceToolInfo } from "@/connectors/connectorTools";
import {
  ConnectorToolsPage,
  type ConnectorToolsPageProps,
} from "@/connectors/ui/ConnectorToolsPage";
import { NOTION_TOOLS } from "@/connectors/ui/testing/serviceTools";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/878";

function renderPage(props: Partial<ConnectorToolsPageProps> = {}) {
  const handlers = { onTryAgain: jest.fn(async () => {}), onBack: jest.fn() };
  render(
    <ConnectorToolsPage
      service={{ name: "Notion" }}
      tools={NOTION_TOOLS.slice(0, 8)}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

function group(name: RegExp): HTMLElement {
  const heading = screen.getByRole("heading", { name });
  return heading.parentElement as HTMLElement;
}

function toolNames(name: RegExp): string[] {
  return within(group(name))
    .getAllByRole("listitem")
    .map((item) => item.firstElementChild?.textContent ?? "");
}

describe("ConnectorToolsPage", () => {
  describe("ConnectorToolsPage()", () => {
    it("titles the page after the service and says what agents can do with it, with Back", () => {
      const { onBack } = renderPage();

      expect(screen.getByRole("heading", { name: "Notion tools" })).toBeTruthy();
      expect(screen.getByText("What agents can do with Notion.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it("groups the tools into read-only ones and ones that can make changes, each with its count", () => {
      renderPage();

      expect(screen.getByRole("heading", { name: "Read only 5" })).toBeTruthy();
      expect(toolNames(/^Read only/)).toEqual([
        "Search Notion and connected sources",
        "Fetch a page or database",
        "Notion get users",
        "Notion get comments",
        "Notion get teams",
      ]);
      expect(screen.getByRole("heading", { name: "Can make changes 3" })).toBeTruthy();
      expect(toolNames(/^Can make changes/)).toEqual([
        "Notion create pages",
        "Notion update page",
        "Notion move pages",
      ]);
    });

    it(`names a tool by its own title, then its annotation title, and otherwise turns its name into words: ${ISSUE}`, () => {
      renderPage({
        tools: [
          { name: "a_tool", title: "Own title", annotations: { title: "Annotation title" } },
          { name: "b_tool", title: " ", annotations: { title: "Annotation title" } },
          { name: "getConfluencePage" },
        ],
      });

      expect(toolNames(/^Can make changes/)).toEqual([
        "Own title",
        "Annotation title",
        "Get confluence page",
      ]);
    });

    it(`shows only the first paragraph of a description, as plain text without its markdown rendered: ${ISSUE}`, () => {
      renderPage({
        tools: [
          {
            name: "search",
            description: "Search **pages** by <b>keyword</b>.\n\n## Usage\n- Pass a query.",
          },
        ],
      });

      expect(screen.getByText("Search **pages** by <b>keyword</b>.")).toBeTruthy();
      expect(screen.queryByText(/Usage/)).toBeNull();
      expect(document.querySelector("b, strong, h2")).toBeNull();
    });

    it("hides a group that has no tools", () => {
      renderPage({ tools: [{ name: "search", annotations: { readOnlyHint: true } }] });

      expect(screen.getByRole("heading", { name: "Read only 1" })).toBeTruthy();
      expect(screen.queryByRole("heading", { name: /^Can make changes/ })).toBeNull();
    });

    it(`clamps a description longer than two lines and expands it with Show more: ${ISSUE}`, () => {
      const heights = jest
        .spyOn(HTMLElement.prototype, "scrollHeight", "get")
        .mockImplementation(function (this: HTMLElement) {
          return this.textContent?.startsWith("Creates one or more") ? 80 : 0;
        });
      try {
        renderPage();

        const description = screen.getByText(/^Creates one or more Notion pages/);
        expect(description.className).toContain("tw-max-h-[2lh]");
        expect(screen.getAllByRole("button", { name: "Show more" })).toHaveLength(1);

        fireEvent.click(screen.getByRole("button", { name: "Show more" }));

        expect(description.className).not.toContain("tw-max-h-[2lh]");
        expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
      } finally {
        heights.mockRestore();
      }
    });

    it("offers no search for 8 tools or fewer", () => {
      renderPage();

      expect(screen.queryByPlaceholderText("Search tools")).toBeNull();
    });

    it("filters more than 8 tools by a search that matches their names and descriptions", () => {
      renderPage({ tools: NOTION_TOOLS });

      fireEvent.change(screen.getByPlaceholderText("Search tools"), {
        target: { value: "comment" },
      });

      expect(screen.getByRole("heading", { name: "Read only 1" })).toBeTruthy();
      expect(toolNames(/^Read only/)).toEqual(["Notion get comments"]);
      expect(toolNames(/^Can make changes/)).toEqual(["Notion create comment"]);

      fireEvent.change(screen.getByPlaceholderText("Search tools"), {
        target: { value: "PARENT" },
      });

      expect(screen.queryByRole("heading", { name: /^Read only/ })).toBeNull();
      expect(toolNames(/^Can make changes/)).toEqual(["Notion create pages", "Notion move pages"]);
    });

    it("says when no tool matches the search", () => {
      renderPage({ tools: NOTION_TOOLS });

      fireEvent.change(screen.getByPlaceholderText("Search tools"), {
        target: { value: "calendar " },
      });

      expect(screen.getByText("No tools match “calendar”")).toBeTruthy();
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    });

    it(`says the service couldn't be reached instead of an empty list when its tools aren't known, and tries again with the button disabled until the check ends: ${ISSUE}`, async () => {
      let finishCheck: () => void = () => {};
      const onTryAgain = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finishCheck = resolve;
          })
      );
      renderPage({ tools: null, onTryAgain });

      expect(screen.getByRole("heading", { name: "Couldn't reach Notion" })).toBeTruthy();
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
      const tryAgain = screen.getByRole("button", { name: "Try again" });

      fireEvent.click(tryAgain);

      expect(onTryAgain).toHaveBeenCalledTimes(1);
      expect(tryAgain.hasAttribute("disabled")).toBe(true);
      await act(async () => finishCheck());
      expect(tryAgain.hasAttribute("disabled")).toBe(false);
    });

    it(`ignores a description a service sends as something other than text: ${ISSUE}`, () => {
      renderPage({
        tools: [{ name: "search", description: { text: "odd" } } as unknown as ServiceToolInfo],
      });

      expect(toolNames(/^Can make changes/)).toEqual(["Search"]);
    });
  });
});
