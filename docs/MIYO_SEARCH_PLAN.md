# Miyo Search Integration Plan (Revised)

## Summary

Integrate Miyo as the semantic index backend while **preserving Copilot’s existing chunking, indexing, and Search v3 UX**. Copilot continues to generate chunks and embeddings locally, but stores vectors and metadata in Miyo via new index-management endpoints. Search v3 keeps its lexical + semantic merge and query expansion, with the semantic leg served by Miyo. Implementation will proceed in two phases: Phase 1 refactors Copilot to abstract Orama; Phase 2 adds Miyo as an additional backend.

## Inputs Read

- `discover_miyo.md`: Service discovery via `~/Library/Application Support/Miyo/service.json` with `host`, `port`, and `pid`.
- `miyo_openapi.json`: Existing `/v0/search` and `/v0/health` endpoints.

## Goals

- Preserve current Copilot chunking and indexing flow (Search v3 chunk IDs, metadata injection).
- Preserve Search v3 experience (lexical + semantic merge, query expansion, dedupe behavior).
- Store vectors and semantic index data in Miyo (not in Orama) when enabled.
- Reuse existing indexing hooks (refresh, force reindex, clear, delete, list) without UI regressions.
- Allow easy switching between Orama and Miyo via a backend abstraction.
- Keep Miyo usage behind the self-host toggle and Miyo toggle.

## Non-Goals

- Changing AI prompts or chat behavior.
- Rewriting lexical search or QueryExpander.
- Forcing a single embedding model for all users (the system remains configurable).

## Proposed Design

### 1. Embedding Provider: Miyo (Toggle-Controlled)

- Add `EmbeddingModelProviders.MIYO` and an internal Miyo embedding model entry.
- **Users do not select Miyo embeddings directly**. The Miyo toggle under self-host mode controls this automatically.
- Implement using `CustomOpenAIEmbeddings` so Miyo’s embeddings are **OpenAI-compatible** (same request/response as Brevilabs embeddings).
- Base URL should resolve to Miyo (self-host URL or discovery result). The embedding endpoint should be `POST /v1/embeddings` on that base URL.
- When Miyo indexing is enabled, automatically switch the embedding model to the Miyo provider and restore the previous embedding model when disabled.

### 2. Index Backend Abstraction (Phase 1)

Introduce a backend interface (example name `SemanticIndexBackend`) to decouple indexing from Orama:

- `initialize(embeddingInstance)`
- `clearIndex()`
- `upsert(doc | docs[])`
- `removeByPath(path)`
- `getIndexedFiles()`
- `getLatestFileMtime()`
- `isIndexEmpty()` / `hasIndex(path)`
- `checkAndHandleEmbeddingModelChange(embeddingInstance)`
- `save()` (no-op for Miyo)
- `checkIndexIntegrity()` (optional for Miyo)

Implement two backends:

- **OramaIndexBackend**: wraps existing `DBOperations` unchanged.
- **MiyoIndexBackend**: calls new Miyo index-management endpoints (Phase 2).

VectorStoreManager should select the backend based on settings:

- Orama when `enableSemanticSearchV3` and Miyo disabled.
- Miyo when self-host + Miyo indexing enabled.

### 3. Reuse Existing Chunking + Indexing Flow

- Keep `IndexOperations.prepareAllChunks()` and its metadata injection.
- Keep chunk IDs (`note_path#chunk_index`) and metadata fields (heading, frontmatter, created/modified). These must be stored in Miyo.
- Replace direct `DBOperations` calls with backend interface calls.

### 4. Search v3: Merge + Expansion Preserved

- Keep `TieredLexicalRetriever` for lexical + query expansion.
- Modify `MergedSemanticRetriever` to accept an injected semantic retriever.
- Implement `MiyoSemanticRetriever` that queries Miyo for semantic results (hybrid search), mapping results into LangChain `Document` objects.
- When Miyo indexing is enabled, semantic leg uses Miyo; otherwise fallback to `HybridRetriever` (Orama).
- **Search response should return only required fields** (no snippet requirement):
  - `path`, `title`, `ctime`, `mtime`, `tags`
  - `chunk_text` (full chunk content)
  - `chunk_index`
  - `metadata.chunkId` (stable `note_path#chunk_index`)
  - `score`

### 5. Indexing Hooks (No UX Change)

Existing commands and UI should continue to work:

- Refresh Vault Index
- Force Reindex Vault
- Clear Index
- List Indexed Files
- Remove From Index

These hooks should call VectorStoreManager which delegates to the chosen backend.

### 6. Service Discovery

- Keep `MiyoServiceDiscovery` to resolve base URL from `service.json`.
- Use discovery for **search**, **embeddings**, and **index management** endpoints.

### 7. Migration + Switching

- Switching from Orama to Miyo should trigger a full reindex (force rebuild) because vectors move stores.
- Switching back from Miyo to Orama should also trigger a full reindex to rebuild local Orama state.
- Miyo can keep data in a single collection for now; Copilot will still pass `source_id` for future isolation.

## Two-Phase Delivery Plan

### Phase 1: Orama Abstraction (No Behavior Change)

- Introduce the index backend interface and refactor Orama usage behind it.
- Keep all existing commands, UI, and indexing flows unchanged.
- Validate that Search v3 behavior is unchanged.

### Phase 2: Add Miyo Backend

- Implement Miyo index backend and retriever.
- Enable Miyo embedding provider toggled by self-host + Miyo switch.
- Wire collection naming per vault and hybrid search endpoint usage.

## Integration Points

- `src/LLMProviders/embeddingManager.ts` (new provider `MIYO`)
- `src/constants.ts` (provider enum + built-in model entry)
- `src/search/indexBackend/*` (new backend abstraction)
- `src/search/vectorStoreManager.ts` (backend selection)
- `src/search/indexOperations.ts` (backend interface usage)
- `src/search/v3/MergedSemanticRetriever.ts` (semantic retriever injection)
- `src/search/miyo/*` (discovery + Miyo client)

## Testing Plan

- Unit tests for backend abstraction (Orama adapter, Miyo adapter)
- Integration test for “force reindex” using Miyo backend (verify calls)
- Manual test: enable Miyo + reindex; confirm search results still include query expansion + lexical merge

## Open Questions (Resolved)

- Miyo embeddings are **not user-selectable**; the Miyo toggle controls them.
- Miyo search should be **hybrid** (BM25 + vector).
- Each vault is a **separate Miyo collection**.
