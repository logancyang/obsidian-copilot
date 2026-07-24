import { applyEmbeddingModelUpdate } from "./embeddingModelUpdate";

interface TestHarness {
  persist: jest.Mock;
  confirmRebuild: jest.Mock;
  rebuildIndex: jest.Mock;
  notifySearchDisabled: jest.Mock;
  confirmCallback?: () => Promise<void>;
}

/** Creates plain callback dependencies for exercising the model-update orchestration. */
function createHarness(): TestHarness {
  const harness: TestHarness = {
    persist: jest.fn(),
    confirmRebuild: jest.fn(),
    rebuildIndex: jest.fn().mockResolvedValue(undefined),
    notifySearchDisabled: jest.fn(),
  };
  harness.confirmRebuild.mockImplementation((callback: () => Promise<void>) => {
    harness.confirmCallback = callback;
  });
  return harness;
}

/** Runs the update flow with the selected model changing from 512 to 1024 dimensions. */
function applySelectedDimensionChange(
  harness: TestHarness,
  overrides: Partial<Parameters<typeof applyEmbeddingModelUpdate>[0]> = {}
): void {
  applyEmbeddingModelUpdate({
    isEmbeddingModel: true,
    isSelectedModel: true,
    currentDimensions: 512,
    updatedDimensions: 1024,
    semanticSearchEnabled: true,
    persist: harness.persist,
    confirmRebuild: harness.confirmRebuild,
    rebuildIndex: harness.rebuildIndex,
    notifySearchDisabled: harness.notifySearchDisabled,
    ...overrides,
  });
}

describe("applyEmbeddingModelUpdate", () => {
  it("waits for confirmation before saving selected-model dimension changes", () => {
    const harness = createHarness();

    applySelectedDimensionChange(harness);

    expect(harness.confirmRebuild).toHaveBeenCalledTimes(1);
    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.rebuildIndex).not.toHaveBeenCalled();
  });

  it("saves and rebuilds after confirmation", async () => {
    const harness = createHarness();
    applySelectedDimensionChange(harness);

    await harness.confirmCallback?.();

    expect(harness.persist).toHaveBeenCalledTimes(1);
    expect(harness.rebuildIndex).toHaveBeenCalledTimes(1);
  });

  it("saves without rebuilding when semantic search is disabled", () => {
    const harness = createHarness();

    applySelectedDimensionChange(harness, { semanticSearchEnabled: false });

    expect(harness.persist).toHaveBeenCalledTimes(1);
    expect(harness.notifySearchDisabled).toHaveBeenCalledTimes(1);
    expect(harness.confirmRebuild).not.toHaveBeenCalled();
    expect(harness.rebuildIndex).not.toHaveBeenCalled();
  });

  it.each([
    { name: "a non-selected model", isSelectedModel: false },
    { name: "a non-embedding model", isEmbeddingModel: false },
    { name: "unchanged dimensions", updatedDimensions: 512 },
  ])("saves $name immediately", (overrides) => {
    const harness = createHarness();

    applySelectedDimensionChange(harness, overrides);

    expect(harness.persist).toHaveBeenCalledTimes(1);
    expect(harness.confirmRebuild).not.toHaveBeenCalled();
  });
});
