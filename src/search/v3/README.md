# Obsidian Copilot — Tiered Note-Level Lexical Retrieval

_(Multilingual, Partial In-Memory; optional semantic add-on)_

---

## 1) Scope & Goals

- **Bounded RAM** on desktop and mobile; no full-vault body index.
- **Instant first results** with progressive refinement.
- **Multilingual** (English + CJK) lexical search via a hybrid tokenizer.
- **Index-free feel**: everything is in-memory and ephemeral by default.
- **Optional semantic engine**: can add extra candidates and a similarity signal, off by default.

---

## 2) High-Level Pipeline

```typescript
async function retrieve(query: string): Promise<NoteIdRank[]> {
  // 1. Expand query
  const variants = await expandQuery(query);

  // 2. GREP for initial candidates
  const grepHits = await batchCachedReadGrep(variants, 200);

  // 3. GRAPH EXPANSION on grep results
  const expandedFromGrep = await graphExpand(grepHits, 1); // 1-hop from EACH grep hit
  const activeNeighbors = await getGraphNeighbors(1); // 1-hop from active note

  // 4. Combine all candidates
  const candidates = unionById([
    ...grepHits,
    ...expandedFromGrep, // Graph expansion from grep hits
    ...activeNeighbors,
  ]).slice(0, 500);

  // 5. Build ephemeral full-text index with expanded candidates
  await buildFullTextIndex(candidates);

  // 6. Search full-text index with all variants
  const fullTextResults = await searchFullText(variants);

  // 7. ENHANCED SEMANTIC (if enabled)
  let semRanking = [];
  if (settings.semantic) {
    // Get semantic candidates
    const semCandidates = await semanticSearch(query, 200);

    // Combine L1 + semantic results
    const combined = unionById([...l1Results, ...semCandidates]);

    // RE-RANK all through embeddings
    const queryEmbeddings = await embedQueries(variants);
    semRanking = await reRankBySimilarity(combined, queryEmbeddings);
  }

  // 8. Weighted RRF fusion
  return weightedRRF({
    lexical: fullTextResults, // weight: 1.0
    semantic: semRanking, // weight: 2.0 (heavier for semantic)
    grepPrior: grepHits, // weight: 0.3 (weak prior)
  }).slice(0, K);
}
```

---

## 3) Data Model

```ts
interface NoteDoc {
  id: string; // vault-relative path
  title: string; // filename or front-matter title
  headings: string[]; // H1..H6 plain text
  tags: string[]; // inline + frontmatter via getAllTags(cache)
  props: Record<string, unknown>; // frontmatter key/values
  linksOut: string[]; // outgoing link targets (paths or basenames)
  linksIn: string[]; // backlinks (paths or basenames)
  body: string; // full markdown text (used only for L1)
  mtime: number; // modification time for recency
}

interface NoteIdRank {
  id: string; // note path
  score: number; // relevance score
  engine?: string; // source engine (l1, semantic, grepPrior)
}
```

---

## 4) Core Components

### 4.1 Grep Scanner (Initial Seeding)

Fast substring search using Obsidian's `cachedRead`:

```ts
class GrepScanner {
  async batchCachedReadGrep(queries: string[], limit: number): Promise<string[]> {
    const files = app.vault.getMarkdownFiles();
    const matches: Set<string> = new Set();
    const batchSize = Platform.isMobile ? 10 : 50;

    for (let i = 0; i < files.length && matches.size < limit; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (file) => {
          const content = await app.vault.cachedRead(file);
          const lower = content.toLowerCase();

          for (const query of queries) {
            if (lower.includes(query.toLowerCase())) {
              matches.add(file.path);
              break;
            }
          }
        })
      );

      // Yield on mobile
      if (Platform.isMobile && i % 100 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    return Array.from(matches).slice(0, limit);
  }
}
```

### 4.2 Graph Expander (Increase Recall)

Expand from grep hits to find related notes:

```ts
class GraphExpander {
  async expandFromNotes(notePaths: string[], hops: number): Promise<string[]> {
    const expanded = new Set<string>(notePaths);

    for (let hop = 0; hop < hops; hop++) {
      const frontier = [...expanded];

      for (const path of frontier) {
        // Get outgoing links
        const outgoing = app.metadataCache.resolvedLinks[path] || {};
        Object.keys(outgoing).forEach((link) => expanded.add(link));

        // Get backlinks
        const backlinks = app.metadataCache.getBacklinksForFile(
          app.vault.getAbstractFileByPath(path)
        );
        if (backlinks) {
          Object.keys(backlinks.data).forEach((link) => expanded.add(link));
        }
      }
    }

    return Array.from(expanded);
  }
}
```

### 4.3 Full-Text Engine (Ephemeral Body Index)

FlexSearch index built per-query:

```ts
class FullTextEngine {
  private index: FlexSearch.Document;
  private bytesUsed = 0;
  private readonly maxBytes: number;

  constructor() {
    this.maxBytes = Platform.isMobile ? 8 * 1024 * 1024 : 20 * 1024 * 1024;
    this.index = new FlexSearch.Document({
      encode: false,
      tokenize: this.tokenizeMixed,
      cache: false,
      document: {
        id: "id",
        index: [
          { field: "title", tokenize: this.tokenizeMixed, weight: 2 },
          { field: "body", tokenize: this.tokenizeMixed, weight: 1 },
        ],
        store: false,
      },
    });
  }

  async buildFromCandidates(paths: string[]): Promise<void> {
    this.clear();

    for (const path of paths) {
      if (this.bytesUsed >= this.maxBytes) break;

      const file = app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        const content = await app.vault.cachedRead(file);
        const bytes = new Blob([content]).size;

        if (this.bytesUsed + bytes <= this.maxBytes) {
          this.index.add({
            id: path,
            title: file.basename,
            body: content,
          });
          this.bytesUsed += bytes;
        }
      }
    }
  }

  search(query: string, limit: number): NoteIdRank[] {
    const results = this.index.search(query, { limit, enrich: true });
    return results.flatMap((r) =>
      r.result.map((id: string, idx: number) => ({
        id,
        score: 1 / (idx + 1),
        engine: "l1",
      }))
    );
  }

  clear(): void {
    this.index = this.createIndex();
    this.bytesUsed = 0;
  }

  private tokenizeMixed(str: string): string[] {
    // ASCII words + CJK bigrams
    const tokens: string[] = [];

    // ASCII words
    const asciiWords = str.toLowerCase().match(/[a-z0-9_]+/g) || [];
    tokens.push(...asciiWords);

    // CJK bigrams
    const cjkPattern = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+/g;
    const cjkMatches = str.match(cjkPattern) || [];

    for (const match of cjkMatches) {
      if (match.length === 1) {
        tokens.push(match);
      }
      for (let i = 0; i < match.length - 1; i++) {
        tokens.push(match.slice(i, i + 2));
      }
    }

    return tokens;
  }
}
```

### 4.4 Semantic Re-ranker (Optional)

When semantic is enabled, re-rank combined results:

```ts
class SemanticReranker {
  async reRankBySimilarity(
    candidates: NoteIdRank[],
    queryEmbeddings: number[][]
  ): Promise<NoteIdRank[]> {
    const scores: Map<string, number> = new Map();

    for (const candidate of candidates) {
      const file = app.vault.getAbstractFileByPath(candidate.id);
      if (file instanceof TFile) {
        const content = await app.vault.cachedRead(file);
        const noteEmbedding = await this.embedText(content.slice(0, 2000));

        // Max similarity across query variants
        let maxSim = 0;
        for (const qEmbed of queryEmbeddings) {
          const sim = this.cosineSimilarity(qEmbed, noteEmbedding);
          maxSim = Math.max(maxSim, sim);
        }

        scores.set(candidate.id, maxSim);
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, score]) => ({ id, score, engine: "semantic" }));
  }
}
```

### 4.5 Weighted RRF Fusion

Combine multiple rankings with different weights:

```ts
function weightedRRF(
  lists: Record<string, NoteIdRank[]>,
  weights: Record<string, number> = {},
  k = 60
): NoteIdRank[] {
  const scores = new Map<string, number>();

  for (const [name, ranking] of Object.entries(lists)) {
    const weight = weights[name] || 1.0;

    ranking.forEach((item, idx) => {
      const current = scores.get(item.id) || 0;
      scores.set(item.id, current + weight * (1 / (k + idx + 1)));
    });
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score }));
}
```

---

## 5) Memory & Performance

- **No persistent index**: Everything built per-query
- **Grep scan**: < 50ms for 1k files (cached)
- **Graph expansion**: < 30ms for 200 nodes
- **L1 build**: < 100ms for 500 candidates
- **Total latency**: < 200ms P95
- **Memory peak**: < 20MB mobile, < 50MB desktop

---

## 6) Settings

- **L1 byte cap**: 8MB (mobile) / 20MB (desktop)
- **Candidate limit**: 500 notes max
- **Graph hops**: 1 (expandable to 2-3 on low recall)
- **Semantic**: Off by default, toggle to enable
- **Semantic weight**: 2.0x in RRF fusion

---

# 4-Day Implementation Plan

## Day 1: Core Infrastructure & Grep Scanner ✅

- [x] Create `NoteDoc` and `NoteIdRank` interfaces
- [x] Implement multilingual tokenizer (ASCII + CJK bigrams)
- [x] Create memory budget manager with platform detection
- [x] Implement `GrepScanner` with batch cachedRead
- [x] Add CJK-aware substring matching
- [x] Optimize batching for mobile (10 files) vs desktop (50 files)
- [x] Add unit tests for tokenizer and grep

## Day 2: Graph Expansion & L1 Engine ✅

- [x] Implement GraphExpander for multi-hop traversal
- [x] **Implement graph expansion from grep results** (1-hop from each hit)
- [x] Add co-citation neighbor discovery
- [x] Create `FullTextEngine` with ephemeral FlexSearch
- [x] Implement byte-capped indexing (8MB mobile / 20MB desktop)
- [x] Add `clear()` for post-query cleanup
- [x] Test L1 memory usage via unit tests

## Day 3: Ranking, Fusion & Semantic Integration ✅

- [x] Implement weighted RRF fusion with configurable weights
- [x] Create `TieredRetriever` main orchestrator
- [x] **Create SemanticReranker structure** (ready for integration)
- [x] Add similarity scoring against query variant embeddings
- [x] Configure heavier weight (2.0x) for semantic ranking in RRF
- [x] Add progressive expansion (increase hops on low recall)

## Day 4: Integration, Optimization & Testing

- [ ] Hook into Obsidian metadataCache events
- [ ] Add file watcher for incremental updates
- [ ] Mobile optimizations (yielding, smaller batches)
- [ ] Create basic settings UI (memory cap, candidate size, semantic toggle)
- [ ] Unit tests for RRF, graph expansion
- [ ] Integration test for full retrieval pipeline
- [ ] Performance benchmarks (latency, memory usage)
- [ ] Migration path from existing engines
- [ ] Document API changes and usage

---

## Current Implementation Status

### ✅ Completed

- ✅ Basic LexicalEngine with FlexSearch (legacy, will be replaced)
- ✅ QueryExpander with LLM integration
- ✅ GrepScanner with batch cachedRead
- ✅ GraphExpander for multi-hop traversal
- ✅ FullTextEngine with ephemeral FlexSearch
- ✅ MemoryManager with platform detection
- ✅ Multilingual tokenizer (ASCII + CJK bigrams)
- ✅ SemanticReranker (placeholder for integration)
- ✅ Weighted RRF fusion
- ✅ TieredRetriever main orchestrator
- ✅ Unit tests for core components

### 🎯 Next Steps

1. Integration with existing VectorStoreManager for semantic search
2. Hook into Obsidian metadataCache events
3. Performance benchmarks and optimization
4. Settings UI for search configuration

### Key Insights

1. **No L0 index needed** - Grep provides fast initial seeding
2. **Graph expansion from grep hits** - Dramatically improves recall
3. **Semantic re-ranking** - Combine L1+semantic, re-rank all through embeddings
4. **Ephemeral L1 only** - Built per-query, no persistence needed

---

## Success Metrics

- [ ] Memory < 20MB mobile, < 50MB desktop
- [ ] P95 latency < 200ms for typical queries
- [ ] Recall@10 > 0.8 for test queries
- [ ] Zero breaking changes for API consumers
- [ ] CJK search working acceptably
