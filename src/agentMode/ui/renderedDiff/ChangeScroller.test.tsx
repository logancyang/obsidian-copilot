import { ChangeScroller, useChangeNavigation } from "@/agentMode/ui/renderedDiff/ChangeScroller";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

const NOTE_HEIGHT = 2000;
const VIEW_HEIGHT = 500;
const LINE_HEIGHT = 24;
const ANCHOR = VIEW_HEIGHT * 0.3;

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

function Harness({ children }: { children: React.ReactNode }): React.ReactElement {
  const navigation = useChangeNavigation();
  return (
    <>
      <output aria-label="Current change">{navigation.current + 1}</output>
      <button type="button" onClick={() => navigation.step(-1)}>
        Previous
      </button>
      <button type="button" onClick={() => navigation.step(1)}>
        Next
      </button>
      <button
        type="button"
        onClick={() => {
          navigation.step(1);
          navigation.step(1);
        }}
      >
        Next twice
      </button>
      <ChangeScroller navigation={navigation}>{children}</ChangeScroller>
    </>
  );
}

const content = (): HTMLElement => document.querySelector<HTMLElement>(".markdown-rendered")!;
const scroller = (): HTMLElement => content().parentElement!;
const markAt = (top: number): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-top="${top}"]`)!;
const currentChange = (): string => screen.getByLabelText("Current change").textContent ?? "";
const press = (name: "Previous" | "Next" | "Next twice"): void => {
  fireEvent.click(screen.getByRole("button", { name }));
};

const tick = (index: number, total: number): HTMLElement =>
  screen.getByRole("button", { name: `Go to change ${index} of ${total}` });

const placement = (button: HTMLElement): [string, string] => [
  button.style.top,
  button.style.height,
];

function ThreeChanges(): React.ReactElement {
  return (
    <Harness>
      <Mark change="inserted" top={200} height={40} />
      <Mark change="inserted" top={800} height={40} />
      <Mark change="inserted" top={1400} height={40} />
    </Harness>
  );
}

describe("ChangeScroller", () => {
  let resize: ((target: Element) => void) | undefined;

  beforeEach(() => {
    HTMLElement.prototype.animate = jest.fn();
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
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  describe("ChangeScroller()", () => {
    it("places one tick per change on the left strip at the change's position in the whole note", () => {
      render(
        <Harness>
          <Mark change="inserted" top={100} height={40} />
          <Mark change="deleted" top={1000} height={100} />
        </Harness>
      );

      expect(placement(tick(1, 2))).toEqual(["5%", "2%"]);
      expect(placement(tick(2, 2))).toEqual(["50%", "5%"]);
    });

    it("joins marks at most a line apart into one tick spanning all of them", () => {
      render(
        <Harness>
          <Mark change="inserted" top={100} height={20} />
          <Mark change="inserted" top={100 + 20 + LINE_HEIGHT} height={56} />
        </Harness>
      );

      expect(placement(tick(1, 1))).toEqual(["5%", "5%"]);
    });

    it("keeps marks more than a line apart as separate ticks", () => {
      render(
        <Harness>
          <Mark change="inserted" top={100} height={20} />
          <Mark change="inserted" top={100 + 20 + LINE_HEIGHT + 1} height={20} />
        </Harness>
      );

      expect(screen.getAllByRole("button", { name: /Go to change/ })).toHaveLength(2);
    });

    it("colors a tick by what changed: added only, removed only, or both", () => {
      render(
        <Harness>
          <Mark change="inserted" top={100} />
          <Mark change="deleted" top={500} />
          <Mark change="deleted" top={900} />
          <Mark change="inserted" top={910} />
        </Harness>
      );

      expect(tick(1, 3).className).toContain("tw-bg-change-inserted");
      expect(tick(2, 3).className).toContain("tw-bg-change-deleted");
      expect(tick(3, 3).className).toContain("tw-bg-change-modified");
    });

    it("counts a changed table row once rather than once per marked word inside it", () => {
      render(
        <Harness>
          <Mark change="inserted" top={100} height={30}>
            <Mark change="inserted" top={1500} />
          </Mark>
        </Harness>
      );

      expect(placement(tick(1, 1))).toEqual(["5%", "1.5%"]);
    });

    it("ignores unchanged lines of a verbatim diff", () => {
      render(
        <Harness>
          <Mark change="unchanged" top={100} />
        </Harness>
      );

      expect(screen.queryAllByRole("button", { name: /Go to change/ })).toEqual([]);
    });

    it("scrolls a change to the upper third of the view when its tick is clicked", () => {
      render(
        <Harness>
          <Mark change="inserted" top={1000} />
        </Harness>
      );

      fireEvent.click(tick(1, 1));

      expect(scroller().scrollTop).toBe(1000 - ANCHOR);
    });

    it("scrolls the note in Obsidian's reading-view container so its text takes the note's font, size and line height (https://github.com/Brevilabs/obsidian-copilot-private/issues/755)", () => {
      render(<Harness>note</Harness>);

      expect(scroller().classList).toContain("markdown-preview-view");
    });

    it("shows no tick strip when nothing changed", () => {
      render(<Harness>note</Harness>);

      expect(screen.queryAllByRole("button", { name: /Go to change/ })).toEqual([]);
    });

    it("adds ticks once a section marks its changes after the first layout (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", async () => {
      render(
        <Harness>
          <p>note</p>
        </Harness>
      );

      const mark = document.createElement("ins");
      Object.assign(mark.dataset, { change: "inserted", top: "400", height: "20" });
      screen.getByText("note").appendChild(mark);

      await waitFor(() => expect(placement(tick(1, 1))).toEqual(["20%", "1%"]));
    });

    it("moves ticks when late-loading images resize the note (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", () => {
      render(
        <Harness>
          <Mark change="inserted" top={400} />
        </Harness>
      );

      markAt(400).dataset.top = "600";
      act(() => resize?.(content()));

      expect(tick(1, 1).style.top).toBe("30%");
    });

    it("re-places ticks when the pane is resized around a note shorter than the view (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", () => {
      render(
        <Harness>
          <Mark change="inserted" top={400} />
        </Harness>
      );

      jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(4000);
      act(() => resize?.(scroller()));

      expect(tick(1, 1).style.top).toBe("10%");
    });
  });

  describe("useChangeNavigation()", () => {
    it("shows the first change as current before the reader reaches it, and steps to it and on through the changes in note order", () => {
      render(<ThreeChanges />);
      expect([currentChange(), scroller().scrollTop]).toEqual(["1", 0]);

      press("Next");
      expect([currentChange(), scroller().scrollTop]).toEqual(["1", 200 - ANCHOR]);
      press("Next");
      expect([currentChange(), scroller().scrollTop]).toEqual(["2", 800 - ANCHOR]);
    });

    it("wraps from the last change back to the first, and from the first back to the last", () => {
      render(<ThreeChanges />);

      press("Next");
      press("Previous");
      expect(currentChange()).toBe("3");
      press("Next");
      expect(currentChange()).toBe("1");
    });

    it("moves two changes for two steps that arrive before the view re-renders, as a held hotkey does (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", () => {
      render(<ThreeChanges />);

      press("Next twice");

      expect(currentChange()).toBe("2");
    });

    it("counts a change that already sits above the upper third when the note opens as reached, so the first step moves past it", () => {
      render(
        <Harness>
          <Mark change="inserted" top={100} height={20} />
          <Mark change="inserted" top={800} height={20} />
        </Harness>
      );
      expect(currentChange()).toBe("1");

      press("Next");

      expect([currentChange(), scroller().scrollTop]).toEqual(["2", 800 - ANCHOR]);
    });

    it("steps from the first change to the second in a note short enough to fit the view, which is at its end from the start (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", () => {
      jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(VIEW_HEIGHT);
      render(
        <Harness>
          <Mark change="inserted" top={100} height={20} />
          <Mark change="inserted" top={300} height={20} />
        </Harness>
      );

      press("Next");

      expect(currentChange()).toBe("2");
    });

    it("goes to the last change when stepping back from above every change", () => {
      render(<ThreeChanges />);

      press("Previous");

      expect([currentChange(), scroller().scrollTop]).toEqual(["3", 1400 - ANCHOR]);
    });

    it("makes the last change above the upper third of the view current when the reader scrolls", () => {
      render(<ThreeChanges />);

      scroller().scrollTop = 900;
      fireEvent.scroll(scroller());
      expect(currentChange()).toBe("2");

      scroller().scrollTop = 0;
      fireEvent.scroll(scroller());
      expect(currentChange()).toBe("1");
    });

    it("makes the last change current once the reader scrolls to the end of a note too short for it to reach the upper third (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", () => {
      render(
        <Harness>
          <Mark change="inserted" top={1500} height={40} />
          <Mark change="inserted" top={1700} height={40} />
        </Harness>
      );

      scroller().scrollTop = NOTE_HEIGHT - VIEW_HEIGHT;
      fireEvent.scroll(scroller());

      expect(currentChange()).toBe("2");
    });

    it("keeps a jumped-to change current when the note ends before it reaches the upper third (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", () => {
      render(
        <Harness>
          <Mark change="inserted" top={1500} height={40} />
          <Mark change="inserted" top={1700} height={40} />
        </Harness>
      );
      let scrollTop = 0;
      Object.defineProperty(scroller(), "scrollTop", {
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.min(value, NOTE_HEIGHT - VIEW_HEIGHT);
        },
      });

      press("Next");
      press("Next");
      fireEvent.scroll(scroller());

      expect(currentChange()).toBe("2");
    });

    it("flashes every mark of the change it jumps to, starting at the highlight and fading back", () => {
      render(
        <Harness>
          <Mark change="inserted" top={200} height={40} />
          <Mark change="deleted" top={260} height={40} />
        </Harness>
      );

      press("Next");

      const animate = jest.mocked(HTMLElement.prototype.animate);
      expect(animate.mock.contexts).toEqual([markAt(200), markAt(260)]);
      expect(animate.mock.calls[0][0]).toEqual([expect.objectContaining({ offset: 0 })]);
    });

    it("jumps without flashing when the reader prefers reduced motion", () => {
      const matchMedia = window.matchMedia;
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({ matches: true }),
      });
      try {
        render(<ThreeChanges />);

        press("Next");

        expect(currentChange()).toBe("1");
        expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
      }
    });
  });
});
