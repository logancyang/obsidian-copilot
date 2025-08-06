// Main exports for v3 search implementation
export { TieredRetriever } from "./TieredRetriever";
export { QueryExpander, type ExpandedQuery } from "./QueryExpander";

// Core interfaces
export type { NoteDoc, NoteIdRank, SearchOptions } from "./interfaces";

// Individual components (for testing/advanced use)
export { GrepScanner } from "./scanners/GrepScanner";
export { GraphExpander } from "./expanders/GraphExpander";
export { FullTextEngine } from "./engines/FullTextEngine";
export { SemanticReranker } from "./rerankers/SemanticReranker";

// Utilities
export { weightedRRF, simpleRRF, type RRFConfig } from "./utils/RRFFusion";
export { MemoryManager } from "./utils/MemoryManager";
