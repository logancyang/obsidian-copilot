/**
 * Core document structure for search indexing
 */
export interface NoteDoc {
  id: string; // vault-relative path
  title: string; // filename or front-matter title
  headings: string[]; // H1..H6 plain text
  tags: string[]; // inline + frontmatter via getAllTags(cache)
  props: Record<string, unknown>; // frontmatter key/values
  linksOut: string[]; // outgoing link targets (paths or basenames)
  linksIn: string[]; // backlinks (paths or basenames)
  body: string; // full markdown text (used only for L1)
  mtime: number; // modification time for recency
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
}
