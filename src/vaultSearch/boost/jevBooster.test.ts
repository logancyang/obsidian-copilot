import { BrevilabsApiError } from "@/LLMProviders/brevilabsClient";
import { JEV_TIMEOUT_MS, JevSearchBooster } from "@/vaultSearch/boost/jevBooster";
import type { SearchCandidate, SearchFile } from "@/vaultSearch/types";

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/516";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const files: SearchFile[] = [
  {
    path: "Inbox/Paper.pdf",
    name: "Paper.pdf",
    basename: "Paper",
    extension: "pdf",
    ctime: 10,
    mtime: 20,
    size: 1000,
    tags: [],
  },
];
const candidates: SearchCandidate[] = [
  {
    path: "Inbox/Paper.pdf",
    title: "Paper",
    folder: "Inbox",
    extension: "pdf",
    snippet: "Result",
    mtime: 20,
    score: 0.4,
    source: "miyo",
  },
];

function booster(broca: jest.Mock) {
  return new JevSearchBooster({
    client: { broca },
    files,
    selectedTypes: new Set(["pdf"]),
    prepareSearch: () => () => null,
    vaultName: "Main",
    now: () => new Date(2026, 8, 18, 14, 32),
  });
}

describe("jevBooster", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe("JevSearchBooster", () => {
    describe("score()", () => {
      it(`keeps at most one Jev call in flight and lets the newest query supersede the older one (${issue})`, async () => {
        const first = deferred<Record<string, { noul: number }>>();
        const broca = jest
          .fn()
          .mockReturnValueOnce(first.promise)
          .mockResolvedValueOnce({ c0: { noul: 0.91 } });
        const instance = booster(broca);

        const older = instance.score("old query", candidates);
        const newer = instance.score("new query", candidates);
        expect(broca).toHaveBeenCalledTimes(1);

        first.resolve({ c0: { noul: 0.2 } });
        await expect(older).rejects.toThrow("superseded");
        await expect(newer).resolves.toEqual(new Map([["Inbox/Paper.pdf", 0.91]]));
        expect(broca).toHaveBeenCalledTimes(2);
      });

      it.each([429, 500])(
        `rejects HTTP %i so basic results remain untouched (${issue})`,
        async (status) => {
          const instance = booster(
            jest.fn().mockRejectedValue(new BrevilabsApiError("failed", status))
          );

          await expect(instance.score("paper", candidates)).rejects.toMatchObject({ status });
        }
      );

      it(`rejects after the 2.5 second client timeout while retaining the underlying in-flight guard (${issue})`, async () => {
        const instance = booster(jest.fn(() => new Promise(() => undefined)));
        const scoring = instance.score("paper", candidates);
        const timedOut = expect(scoring).rejects.toThrow("timed out");

        await jest.advanceTimersByTimeAsync(JEV_TIMEOUT_MS);

        await timedOut;
      });
    });
  });
});
