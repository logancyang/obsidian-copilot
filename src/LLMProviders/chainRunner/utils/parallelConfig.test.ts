import { getSettings } from "@/settings/model";
import { resolveParallelToolConfig } from "./parallelConfig";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));

describe("resolveParallelToolConfig", () => {
  const mockedGetSettings = getSettings as jest.MockedFunction<typeof getSettings>;

  beforeEach(() => {
    mockedGetSettings.mockReset();
  });

  it("returns sequential config when flag disabled", () => {
    mockedGetSettings.mockReturnValue({
      parallelToolCalls: { enabled: false, concurrency: 4 },
    } as any);

    expect(resolveParallelToolConfig(3)).toEqual({ useParallel: false, concurrency: 4 });
  });

  it("enables parallel execution when configured", () => {
    mockedGetSettings.mockReturnValue({
      parallelToolCalls: { enabled: true, concurrency: 6 },
    } as any);

    expect(resolveParallelToolConfig(2)).toEqual({ useParallel: true, concurrency: 6 });
  });

  it("falls back to sequential when concurrency <= 1", () => {
    mockedGetSettings.mockReturnValue({
      parallelToolCalls: { enabled: true, concurrency: 1 },
    } as any);

    expect(resolveParallelToolConfig(5)).toEqual({ useParallel: false, concurrency: 1 });
  });

  it("clamps concurrency upper bound", () => {
    mockedGetSettings.mockReturnValue({
      parallelToolCalls: { enabled: true, concurrency: 42 },
    } as any);

    expect(resolveParallelToolConfig(4)).toEqual({ useParallel: true, concurrency: 10 });
  });
});
