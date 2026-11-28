export interface SearchExplanation {
  lexicalMatches?: {
    field: string;
    query: string;
    weight: number;
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
  baseScore: number;
  finalScore: number;
}

export interface NoteIdRank {
  id: string;
  score: number;
  engine?: string;
  explanation?: SearchExplanation;
}

export interface SearchOptions {
  maxResults?: number;
  l1ByteCap?: number;
  candidateLimit?: number;
  salientTerms?: string[];
  enableLexicalBoosts?: boolean;
  returnAll?: boolean;
  preExpandedQuery?: {
    originalQuery: string;
    queries: string[];
    salientTerms: string[];
    expandedQueries: string[];
  };
}
