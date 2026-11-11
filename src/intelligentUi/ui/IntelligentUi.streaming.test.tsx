import { AppContext } from "@/context";
import { parseIntelligentUi } from "@/intelligentUi/parser";
import { GOLDEN_EXAMPLES } from "@/intelligentUi/testing/golden";
import { RECORDED_STREAM_END, recordedFenceAt } from "@/intelligentUi/ui/UiFence.fixtures";
import { IntelligentUi } from "@/intelligentUi/ui/IntelligentUi";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { act, render } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

jest.mock("@/utils/renderMarkdown", () => ({ renderMarkdown: jest.fn() }));
jest.mock("obsidian", () => ({
  ...jest.requireActual<typeof import("obsidian")>("obsidian"),
  setIcon: jest.fn(),
}));
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/883";
const app = {} as App;
const view = (source: string) => (
  <AppContext.Provider value={app}>
    <IntelligentUi result={parseIntelligentUi(source)} source={source} sourcePath="Topic.md" />
  </AppContext.Provider>
);
const settle = async () => {
  await act(async () => {
    await Promise.allSettled(
      jest.mocked(renderMarkdown).mock.results.map((r) => r.value as Promise<void>)
    );
  });
};
const normalized = (element: HTMLElement) => element.innerHTML.replace(/:r\w+:/g, "ID");

describe("IntelligentUi streaming", () => {
  describe("IntelligentUi()", () => {
    beforeEach(() => {
      jest.mocked(renderMarkdown).mockImplementation(async (_app, text, target) => {
        target.textContent = text;
      });
    });
    it.each(
      Object.entries({
        ...GOLDEN_EXAMPLES,
        recordedClaudeReply: recordedFenceAt(RECORDED_STREAM_END).body,
      })
    )(
      `reveals completed %s content monotonically and retains elements at every character (${ISSUE})`,
      async (_name, source) => {
        const live = render(view(""));
        let previous: Element[] = [];
        let previousText = "";
        for (let end = 1; end <= source.length; end++) {
          live.rerender(view(source.slice(0, end)));
          await settle();
          for (const element of previous) expect(live.container.contains(element)).toBe(true);
          const text = live.container.textContent!.replace("Receiving layout…", "");
          let position = 0;
          for (const character of previousText) {
            position = text.indexOf(character, position);
            expect(position).toBeGreaterThanOrEqual(0);
            position++;
          }
          previousText = text;
          previous = Array.from(live.container.querySelectorAll("[role]:not([role=status])"));
          if (parseIntelligentUi(source.slice(0, end)).status === "pending") {
            expect(live.container.querySelector('[role="status"]')?.textContent).toBe(
              "Receiving layout…"
            );
          }
          expect(live.container.querySelector("pre")).toBeNull();
        }
        const fixed = render(view(source));
        await settle();
        expect(normalized(live.container)).toBe(normalized(fixed.container));
        fixed.unmount();
        live.unmount();
      }
    );
    it(`withholds unfinished text and attributes while showing completed descendants (${ISSUE})`, () => {
      const { container } = render(view('<stack><text>Done</text><card title="half'));
      expect(container.textContent).toContain("Done");
      expect(container.textContent).not.toContain("half");
      expect(container.querySelector('[role="status"]')).not.toBeNull();
    });
    it(`fades new elements in once even when chat re-parents the layout host, and not under reduced motion (${ISSUE})`, () => {
      const animate = jest.spyOn(Element.prototype, "animate");
      const host = document.createElement("div");
      document.body.append(host);
      const live = render(view('<card title="Local"><text>Private</text></card>'), {
        container: host,
      });
      const fades = animate.mock.calls.length;
      expect(fades).toBeGreaterThan(0);
      const moved = document.createElement("section");
      document.body.append(moved);
      moved.append(host);
      live.rerender(view('<card title="Local"><text>Private</text></card>'));
      expect(animate).toHaveBeenCalledTimes(fades);
      live.unmount();
      animate.mockClear();
      const matchMedia = window.matchMedia;
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({ matches: true }),
      });
      try {
        render(view('<card title="Calm"><text>Still</text></card>'));
        expect(animate).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
        animate.mockRestore();
      }
    });
    it(`clears every placeholder in the recorded Claude reply once its last step finishes, before the closing tags arrive (${ISSUE})`, () => {
      const lastStepDone = recordedFenceAt(830);
      expect(lastStepDone.closed).toBe(false);
      const { container } = render(view(lastStepDone.body));
      expect(container.querySelector("[data-placeholder]")).toBeNull();
      expect(container.textContent).toContain("confirm notes appear.");
    });
    it(`eases the layout's height when content arrives after it settles, never in its first moments or under reduced motion (${ISSUE})`, () => {
      jest.useFakeTimers();
      let height = 100;
      let resize = () => {};
      const animate = jest
        .spyOn(Element.prototype, "animate")
        .mockImplementation(() => ({ cancel() {}, onfinish: null }) as unknown as Animation);
      jest
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockImplementation(() => ({ height }) as DOMRect);
      const original = window.ResizeObserver;
      window.ResizeObserver = class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
      const heightAnimations = () =>
        animate.mock.calls.filter(([keyframes]) => JSON.stringify(keyframes).includes('"height"'));
      try {
        render(view('<card title="Local"><text>Private</text></card>'));
        height = 150;
        resize();
        expect(heightAnimations()).toHaveLength(0);
        jest.advanceTimersByTime(400);
        height = 220;
        resize();
        expect(heightAnimations().at(-1)?.[0]).toEqual([{ height: "150px" }, { height: "220px" }]);
        const matchMedia = window.matchMedia;
        Object.defineProperty(window, "matchMedia", {
          configurable: true,
          value: () => ({ matches: true }),
        });
        height = 260;
        resize();
        Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
        expect(heightAnimations()).toHaveLength(1);
      } finally {
        window.ResizeObserver = original;
        jest.restoreAllMocks();
        jest.useRealTimers();
      }
    });
    it(`holds declared grid columns with placeholder cards until their cards arrive (${ISSUE})`, () => {
      const first = '<grid columns="2"><card title="Local"><text>Offline</text></card>';
      const live = render(view(first));
      expect(live.getAllByRole("region")).toHaveLength(1);
      expect(live.container.querySelectorAll('[data-placeholder="card"]')).toHaveLength(1);
      live.rerender(view(first + '<card title="Cloud"><text>Synced</text></card></grid>'));
      expect(live.getAllByRole("region")).toHaveLength(2);
      expect(live.container.querySelector("[data-placeholder]")).toBeNull();
    });
    it(`shows a placeholder only where content is arriving: an unfinished leaf or a newly opened element, never after a finished one (${ISSUE})`, () => {
      const card = '<stack><card title="Local"><text>Private</text>';
      const live = render(view(card + "<text>Off"));
      const local = live.getByRole("region", { name: "Local" });
      expect(live.container.querySelectorAll("[data-placeholder]")).toHaveLength(1);
      expect(local.contains(live.container.querySelector("[data-placeholder]"))).toBe(true);
      live.rerender(view(card + "<text>Offline</text></card>"));
      expect(live.container.querySelector("[data-placeholder]")).toBeNull();
      live.rerender(view(card + "<text>Offline</text></card></sta"));
      expect(live.container.querySelector("[data-placeholder]")).toBeNull();
      live.rerender(view(card + '<text>Offline</text></card><card title="Clo'));
      const placeholders = live.container.querySelectorAll("[data-placeholder]");
      expect(placeholders).toHaveLength(1);
      expect(local.contains(placeholders[0])).toBe(false);
      live.rerender(view(card + "<text>Offline</text></card></stack>"));
      expect(live.container.querySelector("[data-placeholder]")).toBeNull();
      expect(live.getByRole("region", { name: "Local" })).toBe(local);
    });
  });
});
