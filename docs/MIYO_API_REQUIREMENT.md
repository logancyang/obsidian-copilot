# Miyo API Requirements (Copilot-Compatible)

This document defines the Miyo API surface needed for Copilot’s client-managed indexing. Copilot owns chunking and embeddings, and Miyo stores vectors + metadata and serves hybrid search.

## Goals

- Support Copilot’s client-managed ingestion contract in `docs/copilot_integration.md`.
- Partition data per `collection_name` so multiple client vaults can coexist safely.
- Preserve hybrid search (dense + BM25 sparse) and the `/v0/search` response shape Copilot consumes.

## Collection Naming (Copilot-Managed)

Each vault maps to a dedicated Miyo collection. Copilot constructs the collection name as:

- `{vault_name}_{md5(vault_path).slice(0, 3)}`

Example: `my-vault_1bc`

## Non-Goals

- Add cloud sync or multi-tenant authentication.
- Implement vector search-only endpoints beyond what Copilot requires.

## High-Level Approach

1. Add a **client-managed indexing service**.
2. Store client-provided chunks directly in Qdrant, with a `collection_name` payload filter.
3. Maintain a lightweight **client manifest** table for file-level metadata and stats.
4. Extend existing search to filter by `collection_name`.
5. Add an OpenAI-compatible `/v1/embeddings` endpoint to align Copilot’s embedding pipeline.

## API Surface (New/Extended)

Reference: `docs/copilot_integration.md`

- `POST /v1/embeddings` (new)
- `POST /v0/index/upsert` (new)
- `DELETE /v0/index/by_path` (new)
- `POST /v0/index/clear` (new)
- `GET /v0/index/files` (new)
- `GET /v0/index/stats` (new)
- `GET /v0/index/documents` (new)
- `POST /v0/search` (extend to accept `collection_name`)

## API Endpoints (Requests & Responses)

All endpoints below are **Copilot-facing** and should be implemented exactly as specified. Where possible, the response fields match what Orama-backed flows provide today.

### 1. Embeddings (OpenAI-Compatible)

**Endpoint**

- `POST /v1/embeddings`

**Request**

```json
{
  "model": "jina-embeddings-v3",
  "input": ["text1", "text2"],
  "encoding_format": "float"
}
```

**Response**

```json
{
  "data": [{ "embedding": [0.1, 0.2, 0.3] }, { "embedding": [0.4, 0.5, 0.6] }]
}
```

Notes:

- `data.length` must match `input.length`.
- Embeddings must be numeric arrays.

### 2. Upsert Documents (Batch)

**Endpoint**

- `POST /v0/index/upsert`

**Request**

```json
{
  "collection_name": "<collection_name>",
  "documents": [
    {
      "id": "<hash>",
      "path": "Notes/example.md",
      "title": "example",
      "content": "NOTE TITLE: [[example]]\n\nMETADATA:{...}\n\nNOTE BLOCK CONTENT:\n\n...",
      "embedding": [0.1, 0.2, 0.3],
      "embedding_model": "jina-embeddings-v3",
      "created_at": 1730000000000,
      "ctime": 1730000000000,
      "mtime": 1730000000000,
      "tags": ["#tag"],
      "extension": "md",
      "nchars": 1234,
      "metadata": {
        "chunkId": "Notes/example.md#0",
        "heading": "Heading",
        "created": "2025-01-01",
        "modified": "2025-01-02"
      }
    }
  ]
}
```

**Response**

```json
{ "upserted": 10 }
```

### 3. Delete by File Path

**Endpoint**

- `DELETE /v0/index/by_path`

**Request**

```json
{ "collection_name": "<collection_name>", "path": "Notes/example.md" }
```

**Response**

```json
{ "deleted": 12 }
```

Notes:

- Must delete **all chunks** for the given `path` within `collection_name`.
- Response counts are advisory; deleting a missing path should still succeed.

### 4. Clear Index

**Endpoint**

- `POST /v0/index/clear`

**Request**

```json
{ "collection_name": "<collection_name>" }
```

**Response**

```json
{ "cleared": true }
```

### 5. List Indexed Files

**Endpoint**

- `GET /v0/index/files?collection_name=<collection_name>&offset=0&limit=200`

**Response**

```json
{
  "files": [{ "path": "Notes/example.md", "mtime": 1730000000000 }],
  "total": 1234
}
```

### 6. Index Stats

**Endpoint**

- `GET /v0/index/stats?collection_name=<collection_name>`

**Response**

```json
{
  "total_chunks": 12345,
  "total_files": 456,
  "latest_mtime": 1730000000000,
  "embedding_model": "jina-embeddings-v3",
  "embedding_dim": 1536
}
```

### 7. Get Documents by Path

Used when Copilot needs full note context (e.g., explicit `[[Note]]` references).

**Endpoint**

- `GET /v0/index/documents?collection_name=<collection_name>&path=Notes/example.md`

**Response**

```json
{
  "documents": [
    {
      "id": "<hash>",
      "path": "Notes/example.md",
      "title": "example",
      "chunk_index": 0,
      "chunk_text": "NOTE TITLE: [[example]]\n\nMETADATA:{...}\n\nNOTE BLOCK CONTENT:\n\n...",
      "metadata": {
        "chunkId": "Notes/example.md#0",
        "heading": "Heading"
      },
      "embedding_model": "jina-embeddings-v3",
      "ctime": 1730000000000,
      "mtime": 1730000000000,
      "tags": ["#tag"],
      "extension": "md",
      "created_at": 1730000000000,
      "nchars": 1234
    }
  ]
}
```

### 8. Hybrid Search (Copilot Results)

**Endpoint**

- `POST /v0/search`

**Request**

```json
{
  "query": "find notes about scaling databases",
  "collection_name": "<collection_name>",
  "limit": 10,
  "filters": [{ "field": "mtime", "gte": 1738886400000, "lte": 1738972800000 }],
  "embedding": {
    "model": "jina-embeddings-v3",
    "vector": [0.1, 0.2, 0.3]
  }
}
```

**Response**

```json
{
  "results": [
    {
      "id": "<hash>",
      "score": 0.82,
      "path": "Notes/example.md",
      "title": "example",
      "chunk_index": 0,
      "chunk_text": "NOTE TITLE: [[example]]\n\nMETADATA:{...}\n\nNOTE BLOCK CONTENT:\n\n...",
      "metadata": {
        "chunkId": "Notes/example.md#0",
        "heading": "Heading"
      },
      "embedding_model": "jina-embeddings-v3",
      "ctime": 1730000000000,
      "mtime": 1730000000000,
      "tags": ["#tag"],
      "extension": "md",
      "created_at": 1730000000000,
      "nchars": 1234
    }
  ]
}
```

Notes:

- No snippet field is required; `chunk_text` is the full chunk content.
- Response fields intentionally mirror Orama’s document fields so Copilot can map them to LangChain `Document` metadata without special casing.
- `filters` are optional; Copilot uses epoch milliseconds for `mtime`/`ctime` comparisons.

## Data Model

### Qdrant Payload Schema (Client-Managed)

These fields must be present for client-managed documents. The service will map inbound fields to payload keys consistently.

| Field             | Source                                                      | Notes                                                |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `collection_name` | request                                                     | Required for partitioning.                           |
| `file_path`       | `documents[].path`                                          | Use `file_path` in payload to match existing search. |
| `title`           | `documents[].title`                                         | Optional.                                            |
| `mtime`           | `documents[].mtime`                                         | Milliseconds since epoch.                            |
| `ctime`           | `documents[].ctime`                                         | Milliseconds since epoch.                            |
| `tags`            | `documents[].tags`                                          | Optional.                                            |
| `chunk_index`     | `documents[].metadata.chunkId` or `documents[].chunk_index` | Prefer numeric index when provided.                  |
| `chunk_text`      | `documents[].content`                                       | Source text used for BM25 + retrieval.               |
| `metadata`        | `documents[].metadata`                                      | Preserve nested metadata.                            |
| `embedding_model` | `documents[].embedding_model`                               | Stored for stats + mismatch detection.               |

### Qdrant Point IDs

Use a **stable, collision-free** scheme:

- `"{collection_name}:{document.id}"`
- This prevents collisions when multiple clients use the same `id` across vaults.

### Client Manifest (SQLite)

Add a new table for client-managed file metadata to avoid overloading the folder manifest.

Proposed table: `client_indexed_files`

| Column            | Type    | Notes                                |
| ----------------- | ------- | ------------------------------------ |
| `collection_name` | TEXT    | Partition key.                       |
| `path`            | TEXT    | Unique per collection.               |
| `mtime`           | INTEGER | Latest known mtime.                  |
| `ctime`           | INTEGER | Latest known ctime.                  |
| `total_chunks`    | INTEGER | Chunks stored for the path.          |
| `embedding_model` | TEXT    | Single model per collection for now. |
| `embedding_dim`   | INTEGER | From service embedder.               |
| `updated_at`      | INTEGER | Last upsert time.                    |

Primary key: `(collection_name, path)`

## Indexing Flow (Client-Managed)

1. `POST /v1/embeddings` produces embeddings for Copilot.
2. Copilot sends `POST /v0/index/upsert` with embeddings + chunk metadata.
3. Miyo:
   - validates embedding dimensionality,
   - computes **sparse BM25 vectors** from `content`,
   - upserts to Qdrant with `collection_name` filter,
   - updates `client_indexed_files` for each path in the batch.

## Search Flow

- `POST /v0/search` accepts required `collection_name` for Copilot.
- `POST /v0/search` may include `embedding.model` + `embedding.vector` for query validation.
- Apply a Qdrant filter `collection_name == <value>` in hybrid search.
- Return only fields Copilot needs (no snippet requirement):
  - `path`, `title`, `ctime`, `mtime`, `tags`
  - `chunk_text` (full chunk content)
  - `chunk_index`
  - `metadata.chunkId`
  - `score`

## Embeddings Endpoint

`POST /v1/embeddings` will:

- Accept OpenAI-style request with `model`, `input`, `encoding_format`.
- Use the existing ONNX embedder.
- Return `data: [{ embedding: [...] }]` with matching order and length.
- Ignore auth headers (per `docs/copilot_integration.md`).
- For now, only `jina-embeddings-v3` is supported. Reject other models with 400.

## Performance & Storage Notes

- Add Qdrant payload indexes for `collection_name` and `file_path` to speed filtering.
- Upsert should support batches of 100+ chunks (already supported in Qdrant client).
- Listing indexed files and stats should use SQLite for speed, not Qdrant scans.

## Error Handling

- Reject upserts when `embedding_dim` does not match the server’s configured `embedding_dim`.
- Enforce a single `embedding_model` per `collection_name` (return 409 on mismatch).
- Return structured 4xx for invalid requests (missing `collection_name`, empty `documents`).

## Implementation Phases

1. **Schemas + Models**
   - Add Pydantic models for new endpoints.
   - Define client manifest schema and migration.
2. **Qdrant Payload & Indexing**
   - Implement upsert, delete, clear, documents-by-path, files list, stats.
   - Add Qdrant payload indexes for `collection_name` and `file_path`.
3. **Search Extension**
   - Add `collection_name` filter to `searcher.search`.
   - Confirm returned fields match Copilot requirements (no snippet requirement).
4. **Embeddings Endpoint**
   - Add `/v1/embeddings` and validate response ordering.
5. **Tests**
   - API tests for upsert/delete/clear/files/stats/documents.
   - Search filtering by `collection_name`.
   - Embedding shape and order.
6. **Documentation**
   - Update `docs/arch.md` to reflect dual indexing modes.
   - Add a short usage note to `docs/copilot_integration.md`.

## Decisions (Resolved)

1. `/v0/search` defaults to searching across all collections when `collection_name` is omitted.
2. Enforce a single embedding model per `collection_name`.
3. Client-managed indexing bypasses any licensing guard (there is no license enforcement in Miyo today).
4. Supported model for Copilot flow: `jina-embeddings-v3` only (reject others).
