import { mapQuickAskAnchorPositions, type QuickAskAnchorPositions } from "./quickAskAnchorMapping";

function makeChanges() {
  const calls: Array<{ pos: number; assoc?: number }> = [];
  return {
    calls,
    changes: {
      mapPos(pos: number, assoc?: number) {
        calls.push({ pos, assoc });
        return pos * 10 + (assoc ?? 0);
      },
    },
  };
}

describe("mapQuickAskAnchorPositions", () => {
  it("maps cursor selections once so all anchors stay identical", () => {
    const { calls, changes } = makeChanges();
    const anchors: QuickAskAnchorPositions = {
      bottomAnchorPos: 12,
      topAnchorPos: 12,
      focusAnchorPos: 12,
    };

    const result = mapQuickAskAnchorPositions(anchors, changes);

    expect(calls).toEqual([{ pos: 12, assoc: 1 }]);
    expect(result).toEqual({
      bottomAnchorPos: 121,
      topAnchorPos: 121,
      focusAnchorPos: 121,
    });
  });

  it("maps forward selection (focus at bottom) with correct assoc values", () => {
    const { calls, changes } = makeChanges();
    const anchors: QuickAskAnchorPositions = {
      bottomAnchorPos: 20,
      topAnchorPos: 10,
      focusAnchorPos: 20,
    };

    mapQuickAskAnchorPositions(anchors, changes);

    expect(calls).toEqual([
      { pos: 20, assoc: -1 },
      { pos: 10, assoc: 1 },
      { pos: 20, assoc: -1 },
    ]);
  });

  it("maps reverse selection (focus at top) with correct assoc values", () => {
    const { calls, changes } = makeChanges();
    const anchors: QuickAskAnchorPositions = {
      bottomAnchorPos: 20,
      topAnchorPos: 10,
      focusAnchorPos: 10,
    };

    mapQuickAskAnchorPositions(anchors, changes);

    expect(calls).toEqual([
      { pos: 20, assoc: -1 },
      { pos: 10, assoc: 1 },
      { pos: 10, assoc: 1 },
    ]);
  });

  it("handles null anchors gracefully", () => {
    const { changes } = makeChanges();
    const result = mapQuickAskAnchorPositions(
      { bottomAnchorPos: null, topAnchorPos: null, focusAnchorPos: null },
      changes
    );
    expect(result).toEqual({
      bottomAnchorPos: null,
      topAnchorPos: null,
      focusAnchorPos: null,
    });
  });

  it("handles newline-end selections the same as any other bottom anchor", () => {
    const { changes } = makeChanges();
    const result = mapQuickAskAnchorPositions(
      { bottomAnchorPos: 11, topAnchorPos: 2, focusAnchorPos: 11 },
      changes
    );
    expect(result.bottomAnchorPos).toBe(109);
  });
});
