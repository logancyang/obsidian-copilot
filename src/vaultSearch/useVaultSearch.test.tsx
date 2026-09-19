import { useVaultSearch, type UseVaultSearchOptions } from "@/vaultSearch/useVaultSearch";
import type { MiyoSearchResult } from "@/miyo/MiyoClient";
import type { SearchFile } from "@/vaultSearch/types";
import { act, renderHook } from "@testing-library/react";

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/515";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const files: SearchFile[] = [
  {
    path: "Books/Stoicism.epub",
    name: "Stoicism.epub",
    basename: "Stoicism",
    extension: "epub",
    mtime: 20,
  },
  {
    path: "Papers/Attention.pdf",
    name: "Attention.pdf",
    basename: "Attention",
    extension: "pdf",
    mtime: 10,
  },
];

function options(overrides: Partial<UseVaultSearchOptions> = {}): UseVaultSearchOptions {
  return {
    files,
    recentPaths: ["Papers/Attention.pdf"],
    selectedTypes: new Set(["epub", "pdf"]),
    allTypes: ["epub", "pdf"],
    miyoEnabled: true,
    searchMiyo: jest.fn().mockResolvedValue([]),
    prepareSearch: () => () => null,
    debounceMs: 150,
    boosterSettleMs: 400,
    ...overrides,
  };
}

describe("useVaultSearch", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("useVaultSearch()", () => {
    it(`lists recently opened files before the user enters a query (${issue})`, () => {
      const { result } = renderHook(() => useVaultSearch(options()));

      expect(result.current.results).toEqual([
        expect.objectContaining({ path: "Papers/Attention.pdf", source: "recent" }),
      ]);
    });

    it(`discards an older Miyo response after a newer query has completed (${issue})`, async () => {
      const first = deferred<MiyoSearchResult[]>();
      const second = deferred<MiyoSearchResult[]>();
      const searchMiyo = jest
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const { result } = renderHook(() => useVaultSearch(options({ searchMiyo })));

      act(() => result.current.setQuery("stoic"));
      await act(async () => jest.advanceTimersByTime(150));
      act(() => result.current.setQuery("attention"));
      await act(async () => jest.advanceTimersByTime(150));
      await act(async () => {
        second.resolve([
          { id: "second", path: "Papers/Attention.pdf", score: 0.9, snippet: "Second" },
        ]);
        await second.promise;
      });
      await act(async () => {
        first.resolve([
          { id: "first", path: "Books/Stoicism.epub", score: 0.99, snippet: "First" },
        ]);
        await first.promise;
      });

      expect(result.current.results.map(({ path }) => path)).toEqual(["Papers/Attention.pdf"]);
    });

    it(`sends checked extension paths only when at least one type is unchecked (${issue})`, async () => {
      const searchMiyo = jest.fn().mockResolvedValue([]);
      const { result } = renderHook(() =>
        useVaultSearch(
          options({ selectedTypes: new Set(["pdf"]), searchMiyo, allTypes: ["epub", "pdf"] })
        )
      );

      act(() => result.current.setQuery("attention"));
      await act(async () => jest.advanceTimersByTime(150));

      expect(searchMiyo).toHaveBeenCalledWith("attention", [".pdf"]);
    });

    it(`keeps filename matches and reports guidance when Miyo is disabled (${issue})`, () => {
      const searchMiyo = jest.fn();
      const { result } = renderHook(() =>
        useVaultSearch(
          options({
            miyoEnabled: false,
            searchMiyo,
            prepareSearch: () => (name) => (name === "Stoicism" ? { score: 1, matches: [] } : null),
          })
        )
      );

      act(() => result.current.setQuery("stoic"));

      expect(result.current.results.map(({ path }) => path)).toEqual(["Books/Stoicism.epub"]);
      expect(result.current.miyoUnavailable).toBe(true);
      expect(searchMiyo).not.toHaveBeenCalled();
    });

    it(`schedules no settle timer, candidate pool, or re-sort without a booster (${issue})`, () => {
      const { result } = renderHook(() => useVaultSearch(options({ booster: undefined })));

      act(() => result.current.setQuery("stoic"));

      expect(jest.getTimerCount()).toBe(1);
    });
  });
});
