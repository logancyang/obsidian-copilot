import { getScrollableParent } from "@/utils/dom/scrollableParent";

function nest(...overflows: string[]): HTMLElement[] {
  const nodes = overflows.map((overflowY) => {
    const node = document.createElement("div");
    node.style.overflowY = overflowY;
    return node;
  });
  nodes.reduce((parent, child) => parent.appendChild(child));
  document.body.appendChild(nodes[0]);
  return nodes;
}

describe("scrollableParent", () => {
  describe("getScrollableParent()", () => {
    afterEach(() => document.body.replaceChildren());

    it.each(["auto", "scroll"])(
      "returns the nearest ancestor whose vertical overflow is %s",
      (overflow) => {
        const [, scroller, , el] = nest("auto", overflow, "visible", "visible");

        expect(getScrollableParent(el)).toBe(scroller);
      }
    );

    it("ignores the element's own overflow and looks only at its ancestors", () => {
      const [scroller, el] = nest("auto", "auto");

      expect(getScrollableParent(el)).toBe(scroller);
    });

    it("returns null when no ancestor scrolls", () => {
      const [, el] = nest("visible", "hidden");

      expect(getScrollableParent(el)).toBeNull();
    });
  });
});
