/**
 * Core document structure for search indexing
 */
export interface NoteDoc {
  id: string; // vault-relative path
  title: string; // filename or front-matter title
  headings: string[]; // H1..H6 plain text (indexed)
  tags: string[]; // inline + frontmatter via getAllTags(cache) (indexed)
  props: Record<string, unknown>; // frontmatter key/values (values indexed, keys ignored)
  linksOut: string[]; // outgoing link full paths (extracted and indexed as basenames)
  linksIn: string[]; // backlink full paths (extracted and indexed as basenames)
  body: string; // full markdown text (indexed)
}

/**
 * Explanation for why a note ranked high in search results
 */
export interface SearchExplanation {
  lexicalMatches?: {
    field: string; // title, path, tags, body, etc.
    query: string; // which query matched
    weight: number; // field weight used
  }[];
  semanticScore?: number; // similarity score if semantic search was used
  folderBoost?: {
    folder: string;
    documentCount: number;
    boostFactor: number;
  };
  graphBoost?: {
    connections: number;
    boostFactor: number;
  };
  baseScore: number; // score before boosts
  finalScore: number; // score after all adjustments
}

/**
 * Simplified structure for ranking results
 */
export interface NoteIdRank {
  id: string; // note path
  score: number; // relevance score
  engine?: string; // source engine (l1, semantic, grepPrior)
  explanation?: SearchExplanation; // explanation of scoring factors
}

export interface SearchOptions {
  maxResults?: number;
  rrfK?: number;
  enableSemantic?: boolean;
  /** Weight for semantic results (0-1, default: 0.6 = 60% semantic, 40% lexical) */
  semanticWeight?: number;
  l1ByteCap?: number;
  candidateLimit?: number;
  salientTerms?: string[]; // Additional terms to enhance the search
}
