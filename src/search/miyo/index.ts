/**
 * Miyo Integration Module
 *
 * Provides integration with the Miyo local retrieval service for
 * hybrid search (semantic + BM25 lexical) capabilities.
 *
 * Miyo is an alternative to the built-in Orama-based search that
 * handles chunking and embedding server-side.
 */

export { MiyoClient, MiyoApiError } from "./MiyoClient";
export { MiyoBackend } from "./MiyoBackend";
export { MiyoIndexManager } from "./MiyoIndexManager";
export type { MiyoIndexingState, MiyoIndexOptions } from "./MiyoIndexManager";
export type {
  // Configuration
  MiyoClientConfig,
  // Health
  HealthResponse,
  // Search
  SearchRequest,
  SearchResponse,
  SearchResultItem,
  MetadataFilter,
  // Ingest
  IngestRequest,
  IngestChunk,
  IngestChunksRequest,
  IngestResponse,
  // Files
  FilesQueryParams,
  FilesResponse,
  FileStatus,
  // Delete
  DeleteRequest,
  DeleteResponse,
} from "./types";
