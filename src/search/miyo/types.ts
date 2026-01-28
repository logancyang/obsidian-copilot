/**
 * Type definitions for Miyo API based on OpenAPI spec v0.1.0
 * Miyo is a local retrieval service for AI applications.
 */

// ============================================================================
// Health Endpoint
// ============================================================================

/**
 * Response from the health endpoint.
 */
export interface HealthResponse {
  status: string;
  service: string;
  qdrant: string;
}

// ============================================================================
// Search Endpoint
// ============================================================================

/**
 * Filter on time fields or custom metadata.
 */
export interface MetadataFilter {
  /** Field to filter: 'mtime', 'ctime', or 'metadata.{name}' */
  field: string;
  /** Greater than */
  gt?: number | null;
  /** Less than */
  lt?: number | null;
  /** Greater than or equal */
  gte?: number | null;
  /** Less than or equal */
  lte?: number | null;
}

/**
 * Request body for the search endpoint.
 */
export interface SearchRequest {
  /** Search query string (min length: 1) */
  query: string;
  /** Maximum number of results (1-100, default: 10) */
  limit?: number;
  /** Optional filter on time/metadata fields (deprecated, use filters) */
  filter?: MetadataFilter | null;
  /** Multiple filters combined with AND logic */
  filters?: MetadataFilter[] | null;
}

/**
 * Single search result item.
 */
export interface SearchResultItem {
  file_path: string;
  snippet: string;
  score: number;
  title?: string | null;
  mtime?: number | null;
  ctime?: number | null;
  file_name?: string | null;
  chunk_index?: number | null;
  total_chunks?: number | null;
  chunk_text?: string | null;
}

/**
 * Response from the search endpoint.
 */
export interface SearchResponse {
  results: SearchResultItem[];
  query: string;
  count: number;
  execution_time_ms?: number | null;
}

// ============================================================================
// Ingest Endpoint
// ============================================================================

/**
 * Request body for file-based ingest endpoint.
 * Miyo reads the file from filesystem and handles chunking internally.
 */
export interface IngestRequest {
  /** File path to index */
  file: string;
  /** If true, skip change detection and always re-embed (default: false) */
  force?: boolean;
  /** Optional identifier for this file (e.g., external source) */
  source_id?: string | null;
}

/**
 * Request body for chunk-based ingest endpoint.
 * Allows Copilot to control chunking for consistency with lexical search.
 * Chunks are provided as an array of content strings.
 */
export interface IngestChunksRequest {
  /** File path or virtual identifier for this content */
  file: string;
  /** Pre-chunked content strings from ChunkManager */
  chunks: string[];
  /** Optional identifier for this file (e.g., vault name) */
  source_id?: string | null;
  /** If true, skip change detection and always re-embed (default: false) */
  force?: boolean;
}

/**
 * Response from the synchronous ingest endpoint.
 */
export interface IngestResponse {
  status: "completed" | "error";
  action: "indexed" | "updated" | "skipped" | "failed";
  file_path: string;
  chunks_created?: number;
  truncated?: boolean;
  error?: string | null;
}

// ============================================================================
// Files Endpoint
// ============================================================================

/**
 * Status of an indexed file.
 */
export interface FileStatus {
  file_path: string;
  status: "indexed";
  source_id?: string | null;
  indexed_at?: number | null;
  chunk_count?: number | null;
  size?: number | null;
}

/**
 * Query parameters for the files endpoint.
 */
export interface FilesQueryParams {
  /** Filter to files from this source (optional) */
  source_id?: string | null;
  /** Case-insensitive prefix match on file paths (optional) */
  search?: string | null;
  /** Pagination offset (default 0) */
  offset?: number;
  /** Pagination limit (default 50, max 200) */
  limit?: number;
}

/**
 * Paginated file listing response.
 */
export interface FilesResponse {
  files: FileStatus[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

// ============================================================================
// Delete Endpoint
// ============================================================================

/**
 * Request body for delete endpoint.
 * Provide at least one of: file_path, file_paths, or filter.
 */
export interface DeleteRequest {
  /** List of file paths to delete from the index */
  file_paths?: string[] | null;
  /** Exact file_path to delete all chunks for (single file) */
  file_path?: string | null;
  /** Filter on time/metadata fields to select chunks to delete */
  filter?: MetadataFilter | null;
}

/**
 * Response from the delete endpoint.
 */
export interface DeleteResponse {
  status: string;
  /** Number of chunks deleted */
  deleted_chunks: number;
  error?: string | null;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Validation error detail item.
 */
export interface ValidationErrorItem {
  loc: (string | number)[];
  msg: string;
  type: string;
}

/**
 * HTTP validation error response (422).
 */
export interface HTTPValidationError {
  detail: ValidationErrorItem[];
}

// ============================================================================
// Client Configuration
// ============================================================================

/**
 * Configuration for the Miyo client.
 */
export interface MiyoClientConfig {
  /** Base URL for the Miyo service (e.g., http://localhost:8000) */
  baseUrl: string;
  /** Optional API key for authentication */
  apiKey?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Source ID to use for all operations (e.g., vault identifier) */
  sourceId?: string;
}
