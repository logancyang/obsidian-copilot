interface BaseSelectedTextContext {
  id: string;
  content: string;
}

export interface NoteSelectedTextContext extends BaseSelectedTextContext {
  sourceType: "note";
  noteTitle: string;
  notePath: string;
  startLine: number;
  endLine: number;
}

export interface WebSelectedTextContext extends BaseSelectedTextContext {
  sourceType: "web";
  title: string;
  url: string;
  faviconUrl?: string;
}

export interface ChatSelectedTextContext extends BaseSelectedTextContext {
  sourceType: "chat";
  comment?: string;
}

export type SelectedTextContext =
  | NoteSelectedTextContext
  | WebSelectedTextContext
  | ChatSelectedTextContext;

export interface WebTabContext {
  url: string;
  title?: string;
  faviconUrl?: string;
  isLoaded?: boolean;
  isActive?: boolean;
}
