import { mapQuickAskAnchorPositions, type QuickAskAnchorPositions } from "./quickAskAnchorMapping";

const changes = {
  mapPos: (pos: number, assoc = 0) => pos * 10 + assoc,
};

describe("quickAskAnchorMapping", () => {
  describe("mapQuickAskAnchorPositions()", () => {
    it("maps a cursor selection once so all three anchors stay identical", () => {
      const anchors: QuickAskAnchorPositions = {
        bottomAnchorPos: 12,
        topAnchorPos: 12,
        focusAnchorPos: 12,
      };

      expect(mapQuickAskAnchorPositions(anchors, changes)).toEqual({
        bottomAnchorPos: 121,
        topAnchorPos: 121,
        focusAnchorPos: 121,
      });
    });

    it("maps a forward selection with bottom and focus anchored backward and top forward", () => {
      const anchors: QuickAskAnchorPositions = {
        bottomAnchorPos: 20,
        topAnchorPos: 10,
        focusAnchorPos: 20,
      };

      expect(mapQuickAskAnchorPositions(anchors, changes)).toEqual({
        bottomAnchorPos: 199,
        topAnchorPos: 101,
        focusAnchorPos: 199,
      });
    });

    it("maps a reverse selection with the focus anchored forward like the top", () => {
      const anchors: QuickAskAnchorPositions = {
        bottomAnchorPos: 20,
        topAnchorPos: 10,
        focusAnchorPos: 10,
      };

      expect(mapQuickAskAnchorPositions(anchors, changes)).toEqual({
        bottomAnchorPos: 199,
        topAnchorPos: 101,
        focusAnchorPos: 101,
      });
    });

    it("keeps null anchors null", () => {
      expect(
        mapQuickAskAnchorPositions(
          { bottomAnchorPos: null, topAnchorPos: null, focusAnchorPos: null },
          changes
        )
      ).toEqual({ bottomAnchorPos: null, topAnchorPos: null, focusAnchorPos: null });
    });
  });
});
