import { StreamingTextFade, TEXT_FADE_MS } from "@/utils/streamingTextFade";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/886";

function rendered(html: string): HTMLElement {
  const container = document.createElement("div");
  container.append(...new DOMParser().parseFromString(html, "text/html").body.childNodes);
  return container;
}

const fadedText = (container: HTMLElement) =>
  [...container.querySelectorAll("span:not(.math)")].map((span) => span.textContent);

describe("streamingTextFade", () => {
  describe("StreamingTextFade", () => {
    describe("apply()", () => {
      let animations: { element: Element; currentTime: number }[];
      beforeEach(() => {
        jest.useFakeTimers();
        animations = [];
        jest.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element) {
          const animation = { element: this, currentTime: 0 };
          animations.push(animation);
          return animation as unknown as Animation;
        });
      });
      afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
      });

      it(`fades in only the text added since the previous render (${ISSUE})`, () => {
        const fade = new StreamingTextFade();
        fade.apply(rendered("<p>First words</p>"));
        jest.advanceTimersByTime(TEXT_FADE_MS);
        const next = rendered("<p>First words and more</p>");
        fade.apply(next);
        expect(fadedText(next)).toEqual([" and more"]);
        expect(next.textContent).toBe("First words and more");
        expect(animations.at(-1)?.currentTime).toBe(0);
      });

      it(`resumes a fade that a re-render recreated instead of restarting it (${ISSUE})`, () => {
        const fade = new StreamingTextFade();
        fade.apply(rendered("<p>Hello</p>"));
        jest.advanceTimersByTime(120);
        const next = rendered("<p>Hello there</p>");
        fade.apply(next);
        expect(fadedText(next)).toEqual(["Hello", " there"]);
        expect(animations.slice(-2).map((animation) => animation.currentTime)).toEqual([120, 0]);
      });

      it(`wraps text across elements and leaves code, math and layout hosts untouched (${ISSUE})`, () => {
        const fade = new StreamingTextFade();
        const first = rendered(
          '<p>Use <strong>bold</strong> and <code>code</code></p><span class="math">x</span><div data-ui-host><p>card</p></div>'
        );
        fade.apply(first);
        expect(fadedText(first)).toEqual(["Use ", "bold", " and "]);
        expect(first.querySelector("code")?.innerHTML).toBe("code");
        expect(first.querySelector("[data-ui-host]")?.innerHTML).toBe("<p>card</p>");
      });

      it(`stops wrapping once every fade has finished (${ISSUE})`, () => {
        const fade = new StreamingTextFade();
        fade.apply(rendered("<p>Done</p>"));
        jest.advanceTimersByTime(TEXT_FADE_MS);
        const same = rendered("<p>Done</p>");
        fade.apply(same);
        expect(same.querySelector("span")).toBeNull();
      });

      it(`shows new text without fading when the reader prefers reduced motion (${ISSUE})`, () => {
        const matchMedia = window.matchMedia;
        Object.defineProperty(window, "matchMedia", {
          configurable: true,
          value: () => ({ matches: true }),
        });
        try {
          const container = rendered("<p>Calm text</p>");
          new StreamingTextFade().apply(container);
          expect(container.querySelector("span")).toBeNull();
          expect(animations).toHaveLength(0);
        } finally {
          Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
        }
      });
    });
  });
});
