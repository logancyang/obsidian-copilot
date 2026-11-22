import { computeVerticalPlacement, type VerticalPlacementInput } from "./panelPlacement";

function makeInput(overrides: Partial<VerticalPlacementInput> = {}): VerticalPlacementInput {
  return {
    scrollRect: { top: 50, bottom: 850 },
    visibleBottom: null,
    visibleTop: null,
    panelHeight: 400,
    margin: 12,
    gap: 6,
    viewportHeight: 900,
    ...overrides,
  };
}

describe("computeVerticalPlacement", () => {
  it("places below when enough space below", () => {
    const input = makeInput({
      visibleBottom: { top: 100, bottom: 120 },
      visibleTop: { top: 80, bottom: 100 },
    });
    const result = computeVerticalPlacement(input);
    expect(result.top).toBe(120 + 6);
    expect(result.anchorBottomY).toBeUndefined();
  });

  it("places above when not enough space below but enough above", () => {
    const input = makeInput({
      visibleBottom: { top: 700, bottom: 720 },
      visibleTop: { top: 500, bottom: 520 },
    });
    const result = computeVerticalPlacement(input);
    expect(result.anchorBottomY).toBe(500 - 6);
    expect(result.top).toBe(500 - 6 - 400);
  });

  it("centers when neither above nor below fits", () => {
    const input = makeInput({
      scrollRect: { top: 50, bottom: 500 },
      visibleBottom: { top: 200, bottom: 220 },
      visibleTop: { top: 100, bottom: 120 },
      panelHeight: 400,
    });
    const result = computeVerticalPlacement(input);
    expect(result.top).toBe(75);
    expect(result.anchorBottomY).toBeUndefined();
  });

  it("places below when only bottom visible and space fits", () => {
    const input = makeInput({
      visibleBottom: { top: 100, bottom: 120 },
      visibleTop: null,
    });
    const result = computeVerticalPlacement(input);
    expect(result.top).toBe(120 + 6);
    expect(result.anchorBottomY).toBeUndefined();
  });

  it("centers when only bottom visible and below doesn't fit", () => {
    const input = makeInput({
      visibleBottom: { top: 780, bottom: 800 },
      visibleTop: null,
    });
    const result = computeVerticalPlacement(input);
    expect(result.top).toBe(250);
    expect(result.anchorBottomY).toBeUndefined();
  });

  it("does not flip above visibleBottom (regression: panel inside selection)", () => {
    const input = makeInput({
      visibleBottom: { top: 400, bottom: 420 },
      visibleTop: null,
      panelHeight: 400,
    });
    const result = computeVerticalPlacement(input);
    expect(result.top).toBe(420 + 6);
    expect(result.anchorBottomY).toBeUndefined();
  });

  it("places above when only top visible and enough space", () => {
    const input = makeInput({
      visibleTop: { top: 500, bottom: 520 },
      visibleBottom: null,
    });
    const result = computeVerticalPlacement(input);
    expect(result.anchorBottomY).toBe(500 - 6);
    expect(result.top).toBe(500 - 6 - 400);
  });

  it("centers when only top visible and not enough space above", () => {
    const input = makeInput({
      scrollRect: { top: 50, bottom: 850 },
      visibleTop: { top: 100, bottom: 120 },
      visibleBottom: null,
      panelHeight: 400,
    });
    const result = computeVerticalPlacement(input);
    expect(result.top).toBe(250);
    expect(result.anchorBottomY).toBeUndefined();
  });

  it("centers when neither anchor is visible", () => {
    const input = makeInput({
      visibleBottom: null,
      visibleTop: null,
    });
    const result = computeVerticalPlacement(input);
    expect(result.top).toBe(250);
    expect(result.anchorBottomY).toBeUndefined();
  });
});
