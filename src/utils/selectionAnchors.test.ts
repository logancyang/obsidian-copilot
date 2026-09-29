import { computeSelectionAnchors } from "./selectionAnchors";

function makeDoc(lineStarts: number[]) {
  return {
    lineAt(pos: number) {
      const from = [...lineStarts].reverse().find((start) => start <= pos) ?? 0;
      return { from };
    },
  };
}

describe("computeSelectionAnchors", () => {
  it("returns unchanged positions for a regular forward selection", () => {
    const doc = makeDoc([0, 6]);
    const result = computeSelectionAnchors({ from: 1, to: 4, head: 4, empty: false }, doc);

    expect(result).toEqual({ topPos: 1, bottomPos: 4, focusPos: 4 });
  });

  it("backs bottomPos up one character when selection.to lands at a line start", () => {
    const doc = makeDoc([0, 6, 12]);
    const result = computeSelectionAnchors({ from: 2, to: 6, head: 6, empty: false }, doc);

    expect(result).toEqual({ topPos: 2, bottomPos: 5, focusPos: 5 });
  });

  it("does not apply the line-start trap to an empty selection", () => {
    const doc = makeDoc([0, 6]);
    const result = computeSelectionAnchors({ from: 6, to: 6, head: 6, empty: true }, doc);

    expect(result).toEqual({ topPos: 6, bottomPos: 6, focusPos: 6 });
  });

  it("preserves focusPos at selection.from for reverse (backward) selections", () => {
    const doc = makeDoc([0, 10]);
    const result = computeSelectionAnchors({ from: 2, to: 8, head: 2, empty: false }, doc);

    expect(result.focusPos).toBe(2);
    expect(result.topPos).toBe(2);
    expect(result.bottomPos).toBe(8);
  });

  it("applies line-start trap to focusPos when it equals selection.to at a line start", () => {
    const doc = makeDoc([0, 6, 12]);
    const result = computeSelectionAnchors({ from: 2, to: 12, head: 12, empty: false }, doc);

    expect(result.bottomPos).toBe(11);
    expect(result.focusPos).toBe(11);
  });

  it("does not apply line-start trap to focusPos when head != selection.to", () => {
    const doc = makeDoc([0, 6, 12]);
    const result = computeSelectionAnchors({ from: 6, to: 12, head: 6, empty: false }, doc);

    expect(result.bottomPos).toBe(11);
    expect(result.focusPos).toBe(6);
  });
});
