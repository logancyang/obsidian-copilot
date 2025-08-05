export interface Hit {
  noteId: string;
  score: number;
  engine: "lexical" | "graph" | "semantic" | "fallback";
  rank: number;
}

export interface SearchResult {
  noteId: string;
  score: number;
  engines: string[];
}

export interface SearchOptions {
  maxResults?: number;
  rrfK?: number;
  enableLexical?: boolean;
  enableGraph?: boolean;
  enableSemantic?: boolean;
}

export interface RetrieverEngine {
  readonly name: string;
  initialize(vault: any): Promise<void>;
  search(queries: string[], limit?: number): Promise<Hit[]> | Hit[];
  updateFile?(file: any, content: string): void;
  removeFile?(path: string): void;
  cleanup?(): void;
}
