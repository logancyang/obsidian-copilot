import { deduplicateSources } from "@/LLMProviders/chainRunner/utils/toolExecution";

describe("SearchTools deduplication flow", () => {
  function runDedup(
    formattedResults: Array<{
      title: string;
      path: string;
      rerank_score?: number;
      score?: number;
    }>
  ) {
    const sourcesLike = formattedResults.map((d) => ({
      title: d.title || d.path || "Untitled",
      path: d.path || d.title || "",
      score: d.rerank_score || d.score || 0,
    }));

    const dedupedSources = deduplicateSources(sourcesLike);

    const bestByKey = new Map<string, (typeof formattedResults)[number]>();
    for (const d of formattedResults) {
      const key = (d.path || d.title).toLowerCase();
      const existing = bestByKey.get(key);
      if (!existing || (d.rerank_score || 0) > (existing.rerank_score || 0)) {
        bestByKey.set(key, d);
      }
    }

    return dedupedSources
      .map((source) => bestByKey.get((source.path || source.title).toLowerCase()))
      .filter(Boolean) as typeof formattedResults;
  }

  it("keeps document when title fallback is used", () => {
    const formattedResults = [
      {
        title: "Untitled",
        path: "",
        rerank_score: 0.9,
      },
    ];

    const deduped = runDedup(formattedResults);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].title).toBe("Untitled");
  });

  it("deduplicates by path while preserving highest score", () => {
    const formattedResults = [
      {
        title: "Note A",
        path: "folder/note-a.md",
        rerank_score: 0.6,
      },
      {
        title: "Alt Title",
        path: "folder/note-a.md",
        rerank_score: 0.8,
      },
    ];

    const deduped = runDedup(formattedResults);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].rerank_score).toBe(0.8);
    expect(deduped[0].title).toBe("Alt Title");
  });
});
