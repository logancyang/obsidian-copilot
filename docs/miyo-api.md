# Miyo Node Service API

Base URL: `http://127.0.0.1:8742`

All request and response bodies are JSON. Errors always return `{ "detail": "<message>" }`.

---

## Health

### `GET /v0/health`

Returns service and sidecar status.

**Response 200**

```json
{
  "status": "ok | degraded",
  "service": "running",
  "qdrant": "connected | ...",
  "llama_server": "running | ...",
  "model_download_progress": 0.75,
  "embedding_model": "nomic-embed-text-v1.5",
  "batch_size_preset": "default",
  "gpu_variant": "metal | null",
  "indexed_files": 1234
}
```

---

## Search

### `POST /v0/search`

Hybrid semantic + keyword search (dense + BM25, fused via RRF).

**Request body**

```json
{
  "query": "string (required)",
  "folder_path": "string | null — restrict to this folder",
  "path": "string | null — substring filter on file path (case-insensitive)",
  "limit": 10,
  "filters": [
    /* MetadataFilter[], see below */
  ]
}
```

**Response 200**

```json
{
  "results": [
    /* SearchResult[] */
  ],
  "query": "string",
  "count": 5,
  "execution_time_ms": 42.0
}
```

**Errors:** 400 (missing query), 503 (llama-server or Qdrant unavailable)

---

### `POST /v0/search/related`

Find files related to a given file using vector similarity.

**Request body**

```json
{
  "file_path": "string (required) — absolute path",
  "folder_path": "string | null",
  "limit": 10,
  "filters": [
    /* MetadataFilter[] */
  ]
}
```

**Response 200**

```json
{
  "results": [{ "path": "string", "score": 0.95 }],
  "file_path": "string",
  "count": 5,
  "execution_time_ms": 12.0
}
```

**Errors:** 400, 404 (no indexed chunks for the file), 503

---

## Folders

### `GET /v0/folder`

- With `?path=<folder_path>`: returns a single `FolderEntry` (404 if not registered)
- Without `path`: returns `{ "folders": [ FolderEntry[] ] }`

---

### `POST /v0/folder`

Register a folder for indexing. Starts watching and scanning immediately.

**Request body**

```json
{
  "path": "string (required) — absolute path",
  "include_patterns": ["**/*.md"],
  "exclude_patterns": ["**/node_modules/**"],
  "recursive": true
}
```

**Response 201** — `FolderEntry`

**Errors:** 400 (invalid), 409 (already registered)

---

### `PATCH /v0/folder`

Update folder configuration. Only provided fields are changed.

**Request body**

```json
{
  "path": "string (required)",
  "include_patterns": ["**/*.md"],
  "exclude_patterns": ["**/node_modules/**"],
  "recursive": false
}
```

**Response 200** — updated `FolderEntry`

**Errors:** 400, 404

---

### `DELETE /v0/folder`

Unregister a folder and remove all its indexed data.

**Request body**

```json
{ "path": "string (required)" }
```

**Response 200** — deletion summary object

**Errors:** 400, 404

---

### `POST /v0/folder/pause`

Stop file watching for a folder without removing it.

**Request body**

```json
{ "path": "string (required)" }
```

**Response 200**

```json
{ "status": "paused", "path": "string" }
```

**Errors:** 400, 404

---

### `POST /v0/folder/resume`

Resume file watching and trigger a rescan.

**Request body**

```json
{ "path": "string (required)" }
```

**Response 202**

```json
{ "status": "scanning", "path": "string" }
```

**Errors:** 400, 404

---

### `POST /v0/scan`

Manually trigger a rescan of a registered folder.

**Request body**

```json
{
  "path": "string (required)",
  "force": false
}
```

`force: true` re-indexes all files even if unchanged.

**Response 202**

```json
{ "status": "started", "path": "string" }
```

**Errors:** 400, 404

---

## Files & Documents

### `GET /v0/folder/files`

List indexed files with optional filtering and pagination.

**Query parameters**

| Param          | Type                              | Description                     |
| -------------- | --------------------------------- | ------------------------------- |
| `folder_path`  | string                            | Filter by folder                |
| `title`        | string                            | Substring match on title        |
| `file_path`    | string                            | Exact file path match           |
| `mtime_after`  | number                            | Unix timestamp lower bound      |
| `mtime_before` | number                            | Unix timestamp upper bound      |
| `offset`       | integer (default 0)               | Pagination offset               |
| `limit`        | integer                           | Max results (omit for no limit) |
| `order_by`     | `mtime` \| `updated_at` (default) | Sort order                      |

**Response 200**

```json
{
  "files": [
    /* FileEntry[] */
  ],
  "total": 99
}
```

---

### `GET /v0/folder/documents`

Fetch all indexed chunks for a specific file, sorted by chunk index.

**Query parameters**

| Param         | Required | Description                |
| ------------- | -------- | -------------------------- |
| `path`        | yes      | Absolute file path         |
| `folder_path` | no       | Scope to a specific folder |

**Response 200**

```json
{
  "documents": [
    /* DocumentChunk[] */
  ]
}
```

**Errors:** 400, 503

---

## Utilities

### `POST /v0/parse-doc`

Parse a file and return its extracted text content.

**Request body**

```json
{ "path": "string (required) — absolute file path" }
```

**Response 200** — parsed content object (shape varies by file type)

**Errors:**

| Code | Meaning               |
| ---- | --------------------- |
| 400  | Invalid input         |
| 403  | File not readable     |
| 404  | File not found        |
| 415  | Unsupported file type |
| 422  | Parse failed          |
| 500  | Internal error        |

---

### `POST /v0/rebuild-metadata`

Rebuild the manifest by re-syncing metadata from Qdrant. Use when manifest is out of sync.

**Response 200** — `{ "elapsed_ms": 123, ...stats }`

**Errors:** 409 (rebuild already in progress), 503

---

### `POST /v0/llama-server/restart`

Restart the llama-server sidecar, optionally changing the batch size preset.

**Request body**

```json
{ "batch_size_preset": "default" }
```

**Response 200**

```json
{
  "restarted": true,
  "batch_size_preset": "default",
  "status": "running"
}
```

**Errors:** 400

---

### `POST /v1/embeddings`

Generate embeddings. OpenAI-compatible interface, proxied to llama-server.

**Request body**

```json
{
  "model": "nomic-embed-text-v1.5",
  "input": "string or string[]"
}
```

`model` is optional but must match the configured embedding model if provided.

**Response 200** — standard OpenAI embeddings response

**Errors:** 400, 503

---

## Schemas

### MetadataFilter

Range filter on a metadata field.

```json
{
  "field": "mtime",
  "gt": 1700000000,
  "gte": 1700000000,
  "lt": 1800000000,
  "lte": 1800000000
}
```

- `field` can be `mtime`, `ctime`, or any metadata key
- Bare field names (not `mtime`/`ctime` and not prefixed with `metadata.`) are automatically prefixed with `metadata.`
- At least one of `gt`, `gte`, `lt`, `lte` must be present

---

### SearchResult

```json
{
  "path": "string",
  "score": 0.95,
  "title": "string | null",
  "mtime": 1700000000,
  "ctime": 1700000000,
  "file_name": "string | null",
  "chunk_index": 0,
  "total_chunks": 5,
  "chunk_text": "string | null",
  "metadata": {},
  "embedding_model": "string | null",
  "tags": ["string"],
  "extension": ".md",
  "created_at": "string | null",
  "nchars": 1024,
  "folder_path": "string | null"
}
```

---

### FileEntry

```json
{
  "path": "string",
  "title": "string | null",
  "mtime": 1700000000,
  "updated_at": "ISO8601 string",
  "folder_path": "string | null",
  "total_chunks": 5
}
```

---

### DocumentChunk

```json
{
  "id": "string",
  "path": "string | null",
  "title": "string | null",
  "chunk_index": 0,
  "chunk_text": "string | null",
  "metadata": {},
  "embedding_model": "string | null",
  "ctime": 1700000000,
  "mtime": 1700000000,
  "tags": ["string"],
  "extension": ".md",
  "created_at": "ISO8601 string | null",
  "nchars": 1024,
  "folder_path": "string | null"
}
```

---

### FolderEntry

Shape varies — includes at minimum:

```json
{
  "path": "string",
  "include_patterns": ["**/*.md"],
  "exclude_patterns": [],
  "recursive": true
}
```

Plus live stats fields populated by the folder manager.
