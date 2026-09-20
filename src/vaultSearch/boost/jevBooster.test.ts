import { BrevilabsApiError } from "@/LLMProviders/brevilabsClient";
import {
  JEV_BATCH_SIZE,
  JEV_MAX_IN_FLIGHT,
  JEV_TIMEOUT_MS,
  JevSearchBooster,
} from "@/vaultSearch/boost/jevBooster";
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
        `silently leaves an HTTP %i batch unjudged so basic results remain (${issue})`,
        async (status) => {
          const instance = booster(
            jest.fn().mockRejectedValue(new BrevilabsApiError("failed", status))
          );

          await expect(instance.score("paper", candidates)).resolves.toEqual(new Map());
        }
      );

      it(`leaves a batch unjudged after the 2.5 second client budget (${issue})`, async () => {
        const instance = booster(jest.fn(() => new Promise(() => undefined)));
        const scoring = instance.score("paper", candidates);

        await jest.advanceTimersByTimeAsync(JEV_TIMEOUT_MS);

        await expect(scoring).resolves.toEqual(new Map());
      });

      it(`judges 30-question batches in parallel and keeps successful batches when one fails (${issue})`, async () => {
        const batchFiles = Array.from(
          { length: 61 },
          (_, index): SearchFile => ({
            path: `Inbox/Paper ${index}.pdf`,
            name: `Paper ${index}.pdf`,
            basename: `Paper ${index}`,
            extension: "pdf",
            ctime: index,
            mtime: index,
            size: 1000,
            tags: [],
          })
        );
        const batchCandidates = batchFiles.map(
          (file, index): SearchCandidate => ({
            path: file.path,
            title: file.basename,
            folder: "Inbox",
            extension: "pdf",
            snippet: `Result ${index}`,
            content: `Decision ${index}`,
            mtime: index,
            score: 1 - index / 100,
            source: "miyo",
          })
        );
        const broca = jest
          .fn()
          .mockResolvedValueOnce({ c0: { noul: 0.91 } })
          .mockRejectedValueOnce(new BrevilabsApiError("limited", 429))
          .mockResolvedValueOnce({ c0: { noul: 0.72 } });
        const instance = new JevSearchBooster({
          client: { broca },
          files: batchFiles,
          selectedTypes: new Set(["pdf"]),
          prepareSearch: () => () => null,
          vaultName: "Main",
          now: () => new Date(2026, 8, 18, 14, 32),
        });

        const scores = await instance.score("current decision", batchCandidates);

        expect(JEV_BATCH_SIZE).toBe(30);
        expect(JEV_MAX_IN_FLIGHT).toBe(8);
        expect(broca).toHaveBeenCalledTimes(3);
        expect(
          broca.mock.calls.map(
            ([, questions]) => Object.keys(questions as Record<string, unknown>).length
          )
        ).toEqual([30, 30, 1]);
        expect(scores).toEqual(
          new Map([
            ["Inbox/Paper 0.pdf", 0.91],
            ["Inbox/Paper 60.pdf", 0.72],
          ])
        );
      });
    });
  });
});
