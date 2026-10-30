import { recordViewTop } from "@/components/recordViewTop";

describe("recordViewTop", () => {
  describe("recordViewTop()", () => {
    it("stores the view's viewport top offset so mobile drawers can end the view at the keyboard (https://github.com/Brevilabs/obsidian-copilot-private/issues/791)", () => {
      const viewContentEl = document.createElement("div");
      jest.spyOn(viewContentEl, "getBoundingClientRect").mockReturnValue({ top: 143 } as DOMRect);

      recordViewTop(viewContentEl);

      expect(viewContentEl.style.getPropertyValue("--copilot-view-top")).toBe("143px");
    });
  });
});
