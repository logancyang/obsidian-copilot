import {
  applySentinels,
  DEL_CLOSE,
  DEL_OPEN,
  INS_CLOSE,
  INS_OPEN,
} from "@/agentMode/ui/renderedDiff/applySentinels";

/**
 * These cases build the DOM node by node rather than through a Markdown
 * renderer, so each one states exactly the node layout the post-pass has to
 * survive.
 */
function el(tag: string, ...children: Array<Node | string>): HTMLElement {
  const element = document.createElement(tag);
  for (const child of children) element.append(child);
  return element;
}

const PRIVATE_USE = new RegExp(`[${String.fromCharCode(0xe000)}-${String.fromCharCode(0xf8ff)}]`);

const marked = (root: HTMLElement, selector: string): string[] =>
  Array.from(root.querySelectorAll(selector)).map((element) => element.textContent ?? "");

describe("applySentinels", () => {
  describe("applySentinels()", () => {
    it("wraps text between an opening and a closing sentinel and removes the sentinels", () => {
      const root = el(
        "div",
        el("p", `The pilot runs for ${DEL_OPEN}six${DEL_CLOSE}${INS_OPEN}eight${INS_CLOSE} weeks.`)
      );

      applySentinels(root);

      expect(marked(root, "del.copilot-diff-del")).toEqual(["six"]);
      expect(marked(root, "ins.copilot-diff-ins")).toEqual(["eight"]);
      expect(root.textContent).toBe("The pilot runs for sixeight weeks.");
    });

    it("leaves no private-use code point anywhere in the rendered text", () => {
      const root = el(
        "div",
        el("p", `${INS_OPEN}added${INS_CLOSE} and ${DEL_OPEN}removed${DEL_CLOSE}`)
      );

      applySentinels(root);

      expect(PRIVATE_USE.test(root.textContent ?? "")).toBe(false);
    });

    it("marks every segment of a deletion that spans an emphasis boundary", () => {
      const root = el(
        "div",
        el("p", `${DEL_OPEN}plain `, el("strong", "bold"), ` tail${DEL_CLOSE}`)
      );

      applySentinels(root);

      expect(marked(root, "del.copilot-diff-del")).toEqual(["plain ", "bold", " tail"]);
      expect(root.querySelector("strong del.copilot-diff-del")).not.toBeNull();
    });

    it("marks link text inside the anchor so the link still renders as a link", () => {
      const anchor = el("a", "the checklist");
      anchor.setAttribute("href", "https://example.com/v1");
      const root = el("div", el("p", `See ${DEL_OPEN}`, anchor, `${DEL_CLOSE} first.`));

      applySentinels(root);

      expect(root.querySelector("a del.copilot-diff-del")?.textContent).toBe("the checklist");
      expect(root.querySelector("a")?.getAttribute("href")).toBe("https://example.com/v1");
    });

    it("keeps a heading a heading while marking the words inside it", () => {
      const root = el("div", el("h2", `${INS_OPEN}Rollout plan${INS_CLOSE}`));

      applySentinels(root);

      expect(root.querySelector("h2 ins.copilot-diff-ins")?.textContent).toBe("Rollout plan");
    });

    it("tags a table row whose every cell was deleted so the whole row reads as removed", () => {
      const root = el(
        "div",
        el(
          "table",
          el(
            "tbody",
            el("tr", el("td", `${DEL_OPEN}APAC${DEL_CLOSE}`), el("td", `${DEL_OPEN}1${DEL_CLOSE}`))
          )
        )
      );

      applySentinels(root);

      expect(root.querySelector("tr")?.classList.contains("copilot-diff-row-del")).toBe(true);
    });

    it("tags a table row whose every cell was inserted so the whole row reads as added", () => {
      const root = el(
        "div",
        el(
          "table",
          el(
            "tbody",
            el("tr", el("td", `${INS_OPEN}AMER${INS_CLOSE}`), el("td", `${INS_OPEN}4${INS_CLOSE}`))
          )
        )
      );

      applySentinels(root);

      expect(root.querySelector("tr")?.classList.contains("copilot-diff-row-ins")).toBe(true);
    });

    it("leaves a row with one edited cell untagged so only that cell is highlighted", () => {
      const root = el(
        "div",
        el(
          "table",
          el(
            "tbody",
            el("tr", el("td", "EMEA"), el("td", `${DEL_OPEN}2${DEL_CLOSE}${INS_OPEN}3${INS_CLOSE}`))
          )
        )
      );

      applySentinels(root);

      expect(root.querySelector("tr")?.className).toBe("");
      expect(marked(root, "ins.copilot-diff-ins")).toEqual(["3"]);
    });

    it("leaves a fragment without sentinels exactly as the renderer produced it", () => {
      const root = el("div", el("p", "The pilot runs for six weeks."));
      const original = root.querySelector("p")?.firstChild;

      applySentinels(root);

      expect(root.querySelector("p")?.firstChild).toBe(original);
    });
  });
});
