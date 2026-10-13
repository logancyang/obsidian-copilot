import { ChangeScroller } from "@/agentMode/ui/renderedDiff/ChangeScroller";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

const NOTE_HEIGHT = 2000;
const VIEW_HEIGHT = 500;
const LINE_HEIGHT = 24;

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

interface MarkProps {
  change: "inserted" | "deleted" | "unchanged";
  top: number;
  height?: number;
  children?: React.ReactNode;
}

function Mark({ change, top, height = 20, children }: MarkProps): React.ReactElement {
  return (
    <div data-change={change} data-top={top} data-height={height}>
      {children ?? "text"}
    </div>
  );
}

const tick = (index: number, total: number): HTMLElement =>
  screen.getByRole("button", { name: `Go to change ${index} of ${total}` });

const placement = (button: HTMLElement): [string, string] => [
  button.style.top,
  button.style.height,
];

describe("ChangeScroller", () => {
  let resize: ((target: Element) => void) | undefined;

  beforeEach(() => {
    jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(NOTE_HEIGHT);
    jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(VIEW_HEIGHT);
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      return rect(Number(this.dataset.top ?? 0), Number(this.dataset.height ?? 0));
    });
    const computedStyle = window.getComputedStyle.bind(window);
    jest.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      const style = computedStyle(element, pseudo);
      if (element.classList.contains("markdown-rendered")) style.lineHeight = `${LINE_HEIGHT}px`;
      return style;
    });
    window.ResizeObserver = class {
      private readonly observed = new Set<Element>();
      constructor(callback: () => void) {
        resize = (target) => {
          if (this.observed.has(target)) callback();
        };
      }
      observe(target: Element): void {
        this.observed.add(target);
      }
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resize = undefined;
    delete (window as { ResizeObserver?: unknown }).ResizeObserver;
  });

  describe("ChangeScroller()", () => {
    it("places one tick per change on the left strip at the change's position in the whole note", () => {
      render(
        <ChangeScroller>
          <Mark change="inserted" top={100} height={40} />
          <Mark change="deleted" top={1000} height={100} />
        </ChangeScroller>
      );

      expect(placement(tick(1, 2))).toEqual(["5%", "2%"]);
      expect(placement(tick(2, 2))).toEqual(["50%", "5%"]);
    });

    it("joins marks at most a line apart into one tick spanning all of them", () => {
      render(
        <ChangeScroller>
          <Mark change="inserted" top={100} height={20} />
          <Mark change="inserted" top={100 + 20 + LINE_HEIGHT} height={56} />
        </ChangeScroller>
      );

      expect(placement(tick(1, 1))).toEqual(["5%", "5%"]);
    });

    it("keeps marks more than a line apart as separate ticks", () => {
      render(
        <ChangeScroller>
          <Mark change="inserted" top={100} height={20} />
          <Mark change="inserted" top={100 + 20 + LINE_HEIGHT + 1} height={20} />
        </ChangeScroller>
      );

      expect(screen.getAllByRole("button")).toHaveLength(2);
    });

    it("colors a tick by what changed: added only, removed only, or both", () => {
      render(
        <ChangeScroller>
          <Mark change="inserted" top={100} />
          <Mark change="deleted" top={500} />
          <Mark change="deleted" top={900} />
          <Mark change="inserted" top={910} />
        </ChangeScroller>
      );

      expect(tick(1, 3).className).toContain("tw-bg-change-inserted");
      expect(tick(2, 3).className).toContain("tw-bg-change-deleted");
      expect(tick(3, 3).className).toContain("tw-bg-change-modified");
    });

    it("counts a changed table row once rather than once per marked word inside it", () => {
      render(
        <ChangeScroller>
          <Mark change="inserted" top={100} height={30}>
            <Mark change="inserted" top={1500} />
          </Mark>
        </ChangeScroller>
      );

      expect(placement(tick(1, 1))).toEqual(["5%", "1.5%"]);
    });

    it("ignores unchanged lines of a verbatim diff", () => {
      render(
        <ChangeScroller>
          <Mark change="unchanged" top={100} />
        </ChangeScroller>
      );

      expect(screen.queryAllByRole("button")).toEqual([]);
    });

    it("scrolls a change to the upper third of the view when its tick is clicked", () => {
      render(
        <ChangeScroller>
          <Mark change="inserted" top={1000} />
        </ChangeScroller>
      );

      fireEvent.click(tick(1, 1));

      const scroller = screen.getByText("text").parentElement!.parentElement!;
      expect(scroller.scrollTop).toBe(1000 - VIEW_HEIGHT * 0.3);
    });

    it("shows no tick strip when nothing changed", () => {
      render(<ChangeScroller>note</ChangeScroller>);

      expect(screen.queryAllByRole("button")).toEqual([]);
    });

    it("adds ticks once a section marks its changes after the first layout (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", async () => {
      render(
        <ChangeScroller>
          <p>note</p>
        </ChangeScroller>
      );

      const mark = document.createElement("ins");
      Object.assign(mark.dataset, { change: "inserted", top: "400", height: "20" });
      screen.getByText("note").appendChild(mark);

      await waitFor(() => expect(placement(tick(1, 1))).toEqual(["20%", "1%"]));
    });

    it("moves ticks when late-loading images resize the note (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", () => {
      render(
        <ChangeScroller>
          <Mark change="inserted" top={400} />
        </ChangeScroller>
      );

      screen.getByText("text").dataset.top = "600";
      act(() => resize?.(screen.getByText("text").parentElement!));

      expect(tick(1, 1).style.top).toBe("30%");
    });

    it("re-places ticks when the pane is resized around a note shorter than the view (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", () => {
      render(
        <ChangeScroller>
          <Mark change="inserted" top={400} />
        </ChangeScroller>
      );

      jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(4000);
      act(() => resize?.(screen.getByText("text").parentElement!.parentElement!));

      expect(tick(1, 1).style.top).toBe("10%");
    });
  });
});
