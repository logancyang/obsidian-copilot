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

      it(`wraps text across elements and leaves code and math untouched (${ISSUE})`, () => {
        const fade = new StreamingTextFade();
        const first = rendered(
          '<p>Use <strong>bold</strong> and <code>code</code></p><span class="math">x</span>'
        );
        fade.apply(first);
        expect(fadedText(first)).toEqual(["Use ", "bold", " and "]);
        expect(first.querySelector("code")?.innerHTML).toBe("code");
      });

      it("keeps table structure free of fade spans while fading cell text (https://github.com/logancyang/obsidian-copilot/issues/4225)", () => {
        const container = rendered(
          "<table>\n<thead>\n<tr><th>Project</th><th>Last updated</th></tr>\n</thead>\n" +
            "<tbody>\n<tr><td>Example project</td><td>Nov 9</td></tr>\n" +
            "<tr><td>Another project</td><td>Nov 5</td></tr>\n</tbody>\n</table>"
        );
        const originalText = container.textContent;

        new StreamingTextFade().apply(container);

        expect(
          container.querySelectorAll("table > span, thead > span, tbody > span, tr > span")
        ).toHaveLength(0);
        expect(fadedText(container)).toEqual([
          "Project",
          "Last updated",
          "Example project",
          "Nov 9",
          "Another project",
          "Nov 5",
        ]);
        expect(container.textContent).toBe(originalText);
      });

      it("keeps table rows valid as cell text and additional rows arrive (https://github.com/logancyang/obsidian-copilot/issues/4225)", () => {
        const fade = new StreamingTextFade();
        for (const rows of [
          "<tr><td>Docs</td><td>Nov</td></tr>",
          "<tr><td>Docs</td><td>Nov 9</td></tr>",
          "<tr><td>Docs</td><td>Nov 9</td></tr>\n<tr><td>Long project name</td><td>Nov 5</td></tr>",
        ]) {
          const container = rendered(
            "<table>\n<thead>\n<tr><th>Project</th><th>Updated</th></tr>\n</thead>\n<tbody>\n" +
              rows +
              "\n</tbody>\n</table>"
          );
          const originalText = container.textContent;

          fade.apply(container);

          expect(
            container.querySelectorAll("table > span, thead > span, tbody > span, tr > span")
          ).toHaveLength(0);
          expect(container.querySelector("td span")).not.toBeNull();
          expect(container.textContent).toBe(originalText);
          jest.advanceTimersByTime(120);
        }
      });

      it("preserves fade positions after unwrapped whitespace between elements (https://github.com/logancyang/obsidian-copilot/issues/4225)", () => {
        const fade = new StreamingTextFade();
        fade.apply(rendered("<p>First</p>\n<p>Second</p>"));
        jest.advanceTimersByTime(TEXT_FADE_MS);
        const next = rendered("<p>First</p>\n<p>Second and more</p>");

        fade.apply(next);

        expect(fadedText(next)).toEqual([" and more"]);
        expect(next.textContent).toBe("First\nSecond and more");
      });

      it("leaves layout hosts to their own element fades and fades the prose around them (https://github.com/Brevilabs/obsidian-copilot-private/issues/883)", () => {
        const container = rendered(
          '<p>Intro</p><div data-ui-host=""><p>Card text</p></div><p>Outro</p>'
        );
        new StreamingTextFade().apply(container);
        expect(fadedText(container)).toEqual(["Intro", "Outro"]);
        expect(container.querySelector("[data-ui-host]")?.innerHTML).toBe("<p>Card text</p>");
      });

      it(`keeps text whole when a completed Markdown span shortens the rendered text mid-fade (${ISSUE})`, () => {
        const fade = new StreamingTextFade();
        fade.apply(rendered("<p>**hello world </p>"));
        fade.apply(rendered("<p><strong>hello world</strong> </p>"));
        const next = rendered("<p><strong>hello world</strong> again </p>");
        fade.apply(next);
        expect(next.textContent).toBe("hello world again ");
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
