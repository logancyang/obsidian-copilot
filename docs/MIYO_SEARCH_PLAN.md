# Miyo Search Integration Plan

## Summary

Integrate the local Miyo service as the semantic search backend by implementing a `VectorSearchBackend` that calls `POST /v0/search`, discovers the service via `service.json`, and registers it with the existing `SelfHostRetriever`. When self-host mode is enabled and Miyo is available, it replaces the current Orama-based semantic search path while preserving lexical fallbacks.

## Inputs Read

- `discover_miyo.md`: Service discovery via `~/Library/Application Support/Miyo/service.json` with `host`, `port`, and `pid`.
- `miyo_openapi.json`: `POST /v0/search` request/response schema and filter model.

## Goals

- Use only `POST /v0/search` for retrieval.
- Replace semantic search (Orama/HybridRetriever) when self-host mode is enabled and Miyo is available.
- Preserve lexical search as a fallback when Miyo is unavailable.

## Non-Goals

- Indexing, folder management, or any non-search endpoints.
- Changing AI prompts.
- Hardcoded, special-case behavior beyond Miyo service discovery.

## Proposed Design

### 1. Service Discovery + Availability

- Add a small discovery module (for example `src/search/miyo/MiyoServiceDiscovery.ts`) that:
  - Builds `service.json` path using `os.homedir()` + `Library/Application Support/Miyo/service.json`.
  - Reads and parses JSON into `{ host, port, pid }`.
  - Validates `pid` is alive using `process.kill(pid, 0)` (best-effort).
  - Returns a base URL `http://{host}:{port}`.
- Health check via `GET /v0/health` to confirm service readiness.
- Cache the last successful discovery for a short TTL to avoid reading the file on every search.

### 2. Miyo Backend (VectorSearchBackend)

- Create `src/search/backends/MiyoBackend.ts` implementing `VectorSearchBackend`.
- Use `safeFetch` for HTTP requests.
- `search(query, options)`:
  - Convert `options.filter` into Miyo `filters` array:
    - `filter.mtime.gte/lte` -> `{ field: "mtime", gte, lte }`
    - `filter.ctime.gte/lte` -> `{ field: "ctime", gte, lte }`
  - Send `{ query, limit, filters }` to `POST /v0/search`.
  - Apply `minScore` client-side (if provided) since Miyo does not accept it.
  - Convert each result into `VectorSearchResult`:
    - `id`: `${file_path}:${chunk_index ?? 0}`
    - `content`: `chunk_text ?? snippet`
    - `metadata`: `path`, `title`, `mtime`, `ctime`, `chunkIndex`, `totalChunks`
- `searchByVector(...)`:
  - Return an empty list or throw a typed error with `logWarn`, since Miyo only exposes text search.
- `isAvailable()`:
  - `discover()` + `GET /v0/health` -> `true/false`.
- `getEmbeddingDimension()`:
  - Return a sentinel (for example `0`) since embeddings are not used by this backend.

### 3. Retriever Wiring

- Register the backend when self-host mode is enabled:
  - On plugin load, if self-host mode is enabled, create a `MiyoBackend` instance and call `RetrieverFactory.registerSelfHostedBackend`.
  - On settings changes (self-host enable/disable, URL/API key), register/clear the backend accordingly.
- Keep Search v3 behavior (merge + query expansion) by swapping the semantic leg of `MergedSemanticRetriever`:
  - Update `MergedSemanticRetriever` to accept an injected semantic retriever (or factory).
  - Default semantic retriever remains `HybridRetriever`.
  - When self-host mode + Miyo is enabled and available, use `SelfHostRetriever` instead.
  - This preserves `TieredLexicalRetriever` (query expansion + lexical scoring) and the merge logic.
- Update `RetrieverFactory` selection logic so:
  - Self-host + Miyo uses the modified `MergedSemanticRetriever` (lexical + Miyo).
  - If Miyo is unavailable, fall back to `MergedSemanticRetriever` with `HybridRetriever` or to lexical.

### 4. Settings + UI

- Add a new toggle gated by self-host mode, for example `enableMiyoSearch`.
- UI stays within the self-host mode section:
  - Toggle: “Enable Miyo Search (local)”.
  - Helper text: “Uses the local Miyo service. Replaces semantic search while enabled.”
  - When enabled, disable or auto-disable `enableSemanticSearchV3` to avoid redundant indexing.
- Optional: display a small status line based on `isAvailable()` (Healthy / Not Found).

### 5. Tag and Time Filters

- Time range filters map cleanly to Miyo’s `filters` model.
- Tag filtering is not supported by Miyo; handle by post-filtering:
  - After Miyo results return, use `app.metadataCache.getFileCache(file)` + `getAllTags` to filter `tagTerms`.
  - This logic can live in `SelfHostRetriever` (since it has `app` access).

### 6. Logging and Errors

- Use `logInfo`, `logWarn`, `logError` (no `console.log`).
- Soft-fail on discovery or HTTP errors and fall back to semantic/lexical search.

## Integration Points

- `src/search/backends/MiyoBackend.ts` (new)
- `src/search/miyo/MiyoServiceDiscovery.ts` (new)
- `src/search/RetrieverFactory.ts` (selection logic)
- `src/main.ts` (backend registration lifecycle)
- `src/settings/model.ts`, `src/constants.ts`, `src/settings/v2/components/QASettings.tsx` (toggle + defaults)
- `src/search/selfHostRetriever.ts` (optional tag post-filtering)

## Testing Plan

- Unit tests for:
  - `MiyoServiceDiscovery` parsing and PID validation (mock fs/process).
  - `MiyoBackend` filter mapping and result conversion.
- Basic integration test for retriever selection (Miyo enabled vs fallback).

## Open Questions

- Confirm whether semantic indexing should be explicitly disabled when self-host mode is enabled.
