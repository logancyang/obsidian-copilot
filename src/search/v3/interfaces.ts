/**
 * Core document structure for search indexing
 */
export interface NoteDoc {
  id: string; // vault-relative path
  title: string; // filename or front-matter title
  headings: string[]; // H1..H6 plain text (indexed)
  tags: string[]; // inline + frontmatter via getAllTags(cache) (indexed)
  props: Record<string, unknown>; // frontmatter key/values (extracted but not indexed)
  linksOut: string[]; // outgoing link full paths (extracted and indexed as basenames)
  linksIn: string[]; // backlink full paths (extracted and indexed as basenames)
  body: string; // full markdown text (indexed)
}

/**
 * Simplified structure for ranking results
 */
export interface NoteIdRank {
  id: string; // note path
  score: number; // relevance score
  engine?: string; // source engine (l1, semantic, grepPrior)
}

export interface SearchOptions {
  maxResults?: number;
  rrfK?: number;
  enableSemantic?: boolean;
  semanticWeight?: number;
  l1ByteCap?: number;
  candidateLimit?: number;
  graphHops?: number;
  salientTerms?: string[]; // Additional terms to enhance the search
}
