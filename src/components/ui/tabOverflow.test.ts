import { computeVisibleTabIndices } from "@/components/ui/tabOverflow";

const ISSUE_891 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/891";

describe("tabOverflow", () => {
  describe("computeVisibleTabIndices()", () => {
    const base = { widths: [80, 80, 80, 80, 80], gap: 4, overflowWidth: 32 };

    it("shows every tab in order when the whole row fits", () => {
      expect(computeVisibleTabIndices({ ...base, selectedIndex: 0, available: 416 })).toEqual([
        0, 1, 2, 3, 4,
      ]);
    });

    it("counts the gaps between tabs when deciding whether the row fits", () => {
      expect(computeVisibleTabIndices({ ...base, selectedIndex: 0, available: 415 })).toEqual([
        0, 1, 2, 3,
      ]);
    });

    it("keeps the leading tabs that fit beside the overflow button when the row is too wide", () => {
      expect(computeVisibleTabIndices({ ...base, selectedIndex: 1, available: 300 })).toEqual([
        0, 1, 2,
      ]);
    });

    it("returns no tabs when there are none", () => {
      expect(
        computeVisibleTabIndices({ ...base, widths: [], selectedIndex: -1, available: 0 })
      ).toEqual([]);
    });

    it(`moves an overflowed selected tab into the last visible slot for ${ISSUE_891}`, () => {
      expect(computeVisibleTabIndices({ ...base, selectedIndex: 4, available: 300 })).toEqual([
        0, 1, 4,
      ]);
    });

    it(`drops as many trailing tabs as a wider selected tab needs for ${ISSUE_891}`, () => {
      expect(
        computeVisibleTabIndices({
          widths: [80, 80, 80, 80, 150],
          gap: 4,
          overflowWidth: 32,
          selectedIndex: 4,
          available: 300,
        })
      ).toEqual([0, 4]);
    });

    it(`shows only the selected tab when nothing else fits beside it for ${ISSUE_891}`, () => {
      expect(computeVisibleTabIndices({ ...base, selectedIndex: 3, available: 120 })).toEqual([3]);
    });

    it(`keeps the leading tabs unchanged when no tab is selected for ${ISSUE_891}`, () => {
      expect(computeVisibleTabIndices({ ...base, selectedIndex: -1, available: 300 })).toEqual([
        0, 1, 2,
      ]);
    });
  });
});
