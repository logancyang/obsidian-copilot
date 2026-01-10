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
  folderBoost?: {
    folder: string;
    documentCount: number;
    totalDocsInFolder: number;
    relevanceRatio: number;
    boostFactor: number;
  };
  graphBoost?: {
    connections: number;
    boostFactor: number;
  };
  expandedBoost?: number; // score contribution from expanded terms (10% weight)
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
  l1ByteCap?: number;
  candidateLimit?: number;
  salientTerms?: string[]; // Additional terms to enhance the search
  /** Enable lexical boosts (folder and graph) - default: true */
  enableLexicalBoosts?: boolean;
  /** When true, bypasses max result ceilings and returns every matching chunk */
  returnAll?: boolean;
}
