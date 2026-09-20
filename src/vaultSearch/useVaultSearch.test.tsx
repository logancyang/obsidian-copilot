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
    ctime: 15,
    mtime: 20,
    size: 200,
    tags: [],
  },
  {
    path: "Papers/Attention.pdf",
    name: "Attention.pdf",
    basename: "Attention",
    extension: "pdf",
    ctime: 5,
    mtime: 10,
    size: 100,
    tags: [],
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

    it(`over-fetches checked extension paths and keeps 30 verified files when a type is unchecked (${issue})`, async () => {
      const searchMiyo = jest.fn().mockResolvedValue(
        Array.from({ length: 50 }, (_, index) => ({
          id: `result-${index}`,
          path: index < 10 ? `Books/Stoicism ${index}.epub` : `Papers/Attention ${index - 10}.pdf`,
          score: 1 - index / 100,
        }))
      );
      const { result } = renderHook(() =>
        useVaultSearch(
          options({ selectedTypes: new Set(["pdf"]), searchMiyo, allTypes: ["epub", "pdf"] })
        )
      );

      act(() => result.current.setQuery("attention"));
      await act(async () => jest.advanceTimersByTime(150));

      expect(searchMiyo).toHaveBeenCalledWith("attention", 200, [".pdf"]);
      expect(result.current.results).toHaveLength(30);
      expect(result.current.results.every(({ extension }) => extension === "pdf")).toBe(true);
    });

    it(`requests 30 Miyo results without paths when every type is checked (${issue})`, async () => {
      const searchMiyo = jest.fn().mockResolvedValue([]);
      const { result } = renderHook(() => useVaultSearch(options({ searchMiyo })));

      act(() => result.current.setQuery("attention"));
      await act(async () => jest.advanceTimersByTime(150));

      expect(searchMiyo).toHaveBeenCalledWith("attention", 30, undefined);
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

    it(`sorts judged rows by probability while leaving unjudged rows in their basic order (${"https://github.com/Brevilabs/obsidian-copilot-private/issues/516"})`, async () => {
      const booster = {
        extraCandidates: jest.fn(() => []),
        score: jest.fn().mockResolvedValue(new Map([["Papers/Attention.pdf", 0.92]])),
      };
      const { result } = renderHook(() =>
        useVaultSearch(
          options({
            booster,
            miyoEnabled: false,
            prepareSearch: () => (name) => ({
              score: name === "Stoicism" ? 10 : 5,
              matches: [],
            }),
          })
        )
      );

      act(() => result.current.setQuery("paper"));
      await act(async () => jest.advanceTimersByTime(400));

      expect(result.current.results.map(({ path }) => path)).toEqual([
        "Papers/Attention.pdf",
        "Books/Stoicism.epub",
      ]);
      expect(result.current.results[0].boostScore).toBe(0.92);
    });

    it(`waits for the current Miyo result before building one boost pool (${"https://github.com/Brevilabs/obsidian-copilot-private/issues/516"})`, async () => {
      const miyo = deferred<MiyoSearchResult[]>();
      const booster = {
        extraCandidates: jest.fn(() => []),
        score: jest.fn().mockResolvedValue(new Map([["Papers/Attention.pdf", 0.92]])),
      };
      const { result } = renderHook(() =>
        useVaultSearch(options({ booster, searchMiyo: jest.fn(() => miyo.promise) }))
      );

      act(() => result.current.setQuery("paper"));
      await act(async () => jest.advanceTimersByTime(400));
      expect(booster.score).not.toHaveBeenCalled();

      await act(async () => {
        miyo.resolve([
          { id: "paper", path: "Papers/Attention.pdf", score: 0.8, snippet: "Result" },
        ]);
        await miyo.promise;
      });

      expect(booster.score).toHaveBeenCalledTimes(1);
      expect(booster.score).toHaveBeenCalledWith(
        "paper",
        expect.arrayContaining([expect.objectContaining({ path: "Papers/Attention.pdf" })])
      );
      expect(result.current.results[0]).toMatchObject({
        path: "Papers/Attention.pdf",
        boostScore: 0.92,
      });
    });

    it(`starts the same boost immediately when requested before the settle delay (${"https://github.com/Brevilabs/obsidian-copilot-private/issues/516"})`, async () => {
      const booster = {
        extraCandidates: jest.fn(() => []),
        score: jest.fn().mockResolvedValue(new Map()),
      };
      const { result } = renderHook(() => useVaultSearch(options({ booster, miyoEnabled: false })));

      act(() => result.current.setQuery("paper"));
      act(() => result.current.boostNow());
      await act(async () => jest.advanceTimersByTime(0));

      expect(booster.score).toHaveBeenCalledTimes(1);
    });

    it(`restores the untouched basic order when AI boost is turned off (${"https://github.com/Brevilabs/obsidian-copilot-private/issues/516"})`, async () => {
      const booster = {
        extraCandidates: jest.fn(() => []),
        score: jest.fn().mockResolvedValue(new Map([["Papers/Attention.pdf", 0.92]])),
      };
      const initialProps: { activeBooster: UseVaultSearchOptions["booster"] } = {
        activeBooster: booster,
      };
      const { result, rerender } = renderHook(
        ({ activeBooster }) =>
          useVaultSearch(
            options({
              booster: activeBooster,
              miyoEnabled: false,
              prepareSearch: () => (name) => ({
                score: name === "Stoicism" ? 10 : 5,
                matches: [],
              }),
            })
          ),
        { initialProps }
      );

      act(() => result.current.setQuery("paper"));
      await act(async () => jest.advanceTimersByTime(400));
      expect(result.current.results[0]).toMatchObject({
        path: "Papers/Attention.pdf",
        boostScore: 0.92,
      });

      rerender({ activeBooster: undefined });
      expect(result.current.results.map(({ path }) => path)).toEqual([
        "Books/Stoicism.epub",
        "Papers/Attention.pdf",
      ]);
      expect(result.current.results.every(({ boostScore }) => boostScore === undefined)).toBe(true);
    });

    it.each([
      ["a timeout", new Error("AI boost timed out")],
      ["HTTP 429", Object.assign(new Error("failed"), { status: 429 })],
      ["HTTP 500", Object.assign(new Error("failed"), { status: 500 })],
    ])(
      `leaves the basic list unchanged when AI boost fails with %s (${"https://github.com/Brevilabs/obsidian-copilot-private/issues/516"})`,
      async (_failure, error) => {
        const booster = {
          extraCandidates: jest.fn(() => []),
          score: jest.fn().mockRejectedValue(error),
        };
        const { result } = renderHook(() =>
          useVaultSearch(
            options({
              booster,
              miyoEnabled: false,
              prepareSearch: () => (name) =>
                name === "Stoicism" ? { score: 1, matches: [] } : null,
            })
          )
        );

        act(() => result.current.setQuery("stoic"));
        const before = result.current.results;
        await act(async () => jest.advanceTimersByTime(400));

        expect(result.current.results).toBe(before);
        expect(result.current.results.map(({ path }) => path)).toEqual(["Books/Stoicism.epub"]);
      }
    );
  });
});
