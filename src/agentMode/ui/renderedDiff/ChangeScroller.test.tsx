import { ChangeScroller } from "@/agentMode/ui/renderedDiff/ChangeScroller";
import type { ChangeKind, ChangeRun } from "@/agentMode/ui/renderedDiff/RenderedDiff";
import { act, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

const NOTE_HEIGHT = 2000;
const VIEW_HEIGHT = 500;

function rect(top: number, height: number): DOMRect {
  return {
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
  } as DOMRect;
}

function block(top: number, height: number): HTMLElement {
  const element = document.createElement("p");
  jest.spyOn(element, "getBoundingClientRect").mockReturnValue(rect(top, height));
  return element;
}

function run(kind: ChangeKind, ...blocks: [HTMLElement, ChangeKind][]): ChangeRun {
  return { kind, blocks: blocks.map(([element, blockKind]) => ({ element, kind: blockKind })) };
}

const bars = (container: HTMLElement): [string | null, string, string][] =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-change-bar]")).map((bar) => [
    bar.dataset.changeBar ?? null,
    bar.style.top,
    bar.style.height,
  ]);

describe("ChangeScroller", () => {
  let resize: (() => void) | undefined;

  beforeEach(() => {
    jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(NOTE_HEIGHT);
    jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(VIEW_HEIGHT);
    window.ResizeObserver = class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resize = undefined;
    delete (window as { ResizeObserver?: unknown }).ResizeObserver;
  });

  describe("ChangeScroller()", () => {
    it("draws a bar in the margin beside each changed block, colored by what changed in that block", () => {
      const runs = [
        run("modified", [block(100, 40), "inserted"], [block(150, 20), "deleted"]),
        run("modified", [block(900, 60), "modified"]),
      ];

      const { container } = render(<ChangeScroller runs={runs}>note</ChangeScroller>);

      expect(bars(container)).toEqual([
        ["inserted", "100px", "40px"],
        ["deleted", "150px", "20px"],
        ["modified", "900px", "60px"],
      ]);
    });

    it("places one tick per change on the left strip at the change's position in the whole note", () => {
      const runs = [
        run("inserted", [block(100, 40), "inserted"], [block(150, 50), "inserted"]),
        run("deleted", [block(1000, 100), "deleted"]),
      ];

      render(<ChangeScroller runs={runs}>note</ChangeScroller>);

      const first = screen.getByRole("button", { name: "Go to change 1 of 2" });
      const second = screen.getByRole("button", { name: "Go to change 2 of 2" });
      expect([first.style.top, first.style.height]).toEqual(["5%", "5%"]);
      expect([second.style.top, second.style.height]).toEqual(["50%", "5%"]);
    });

    it("scrolls a change to the upper third of the view when its tick is clicked", () => {
      render(
        <ChangeScroller runs={[run("inserted", [block(1000, 40), "inserted"])]}>
          note
        </ChangeScroller>
      );

      fireEvent.click(screen.getByRole("button", { name: "Go to change 1 of 1" }));

      const scroller = screen.getByText("note").parentElement!;
      expect(scroller.scrollTop).toBe(1000 - VIEW_HEIGHT * 0.3);
    });

    it("shows no bars and no tick strip when nothing changed", () => {
      const { container } = render(<ChangeScroller runs={[]}>note</ChangeScroller>);

      expect(bars(container)).toEqual([]);
      expect(screen.queryAllByRole("button")).toEqual([]);
    });

    it("moves bars and ticks when late-loading images resize the note (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", () => {
      const changed = block(400, 40);
      const { container } = render(
        <ChangeScroller runs={[run("inserted", [changed, "inserted"])]}>note</ChangeScroller>
      );

      jest.mocked(changed.getBoundingClientRect).mockReturnValue(rect(600, 40));
      act(() => resize?.());

      expect(bars(container)).toEqual([["inserted", "600px", "40px"]]);
      expect(screen.getByRole("button", { name: "Go to change 1 of 1" }).style.top).toBe("30%");
    });
  });
});
