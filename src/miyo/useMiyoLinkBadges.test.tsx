import { TooltipProvider } from "@/components/ui/tooltip";
import { useMiyoLinkBadges } from "@/miyo/useMiyoLinkBadges";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { App } from "obsidian";
import * as React from "react";

const app = {
  metadataCache: {
    getFirstLinkpathDest: (linkpath: string) => ({ path: `${linkpath}.md` }),
  },
} as unknown as App;

function fillLinks(container: HTMLElement): HTMLElement {
  container.replaceChildren();
  for (const note of ["Standing desk setup", "Reading list"]) {
    container.createEl("a", {
      cls: "internal-link",
      text: note,
      attr: { "data-href": `notes/${note}` },
    });
  }
  return container;
}

function renderBadges(miyoPaths: string[]) {
  const container = fillLinks(document.body.appendChild(document.createElement("div")));
  const hook = renderHook(() => useMiyoLinkBadges(app, "", miyoPaths));
  act(() => hook.result.current.markFoundLinks(container));
  const view = render(<TooltipProvider>{hook.result.current.badges}</TooltipProvider>);
  return { container, hook, view };
}

describe("useMiyoLinkBadges", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  describe("useMiyoLinkBadges()", () => {
    it("badges only the rendered links to notes in the Miyo results", () => {
      renderBadges(["notes/Standing desk setup.md"]);

      const badges = screen.getAllByRole("img", { name: "Found by Miyo" });
      expect(badges).toHaveLength(1);
      expect(badges[0].parentElement?.nextElementSibling?.textContent).toBe("Standing desk setup");
    });

    it("replaces the earlier badges instead of adding to them when links are marked again", () => {
      const { container, hook, view } = renderBadges(["notes/Standing desk setup.md"]);

      act(() => hook.result.current.markFoundLinks(container));
      view.rerender(<TooltipProvider>{hook.result.current.badges}</TooltipProvider>);

      expect(screen.getAllByRole("img", { name: "Found by Miyo" })).toHaveLength(1);
    });

    it("adds no badge or badge host when there are no Miyo results", () => {
      const { container } = renderBadges([]);

      expect(screen.queryByRole("img", { name: "Found by Miyo" })).toBeNull();
      expect(container.querySelector("span")).toBeNull();
    });
  });
});
