export interface UserSystemPrompt {
  /**
   * Title of the system prompt (used as filename)
   */
  title: string;

  /**
   * Content of the system prompt without frontmatter
   */
  content: string;

  /**
   * Whether this is a built-in template
   */
  isBuiltIn?: boolean;

  /**
   * Timestamp when the prompt was created
   */
  createdMs: number;

  /**
   * Timestamp when the prompt was last modified
   */
  modifiedMs: number;

  /**
   * Timestamp of the last time the system prompt was used
   */
  lastUsedMs: number;
}
