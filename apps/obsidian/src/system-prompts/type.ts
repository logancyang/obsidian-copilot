export interface UserSystemPrompt {
  title: string;

  content: string;

  isBuiltIn?: boolean;

  createdMs: number;

  modifiedMs: number;

  lastUsedMs: number;
}
