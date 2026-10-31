import { getDefaultPanelWidth } from "@/components/quick-ask/QuickAskOverlay";

describe("QuickAskOverlay", () => {
  describe("getDefaultPanelWidth()", () => {
    it("opens at 420px when the editor has room for it", () => {
      expect(getDefaultPanelWidth(1000)).toBe(420);
    });

    it("fills the editor width minus its 12px margins when 420px does not fit", () => {
      expect(getDefaultPanelWidth(390)).toBe(366);
    });
  });
});
