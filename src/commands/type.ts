export interface CustomCommand {
  /**
   * Title of the custom command
   */
  title: string;

  /**
   * Content of the custom command without frontmatter
   */
  content: string;

  /**
   * Whether the custom command is enabled as a context menu item
   */
  showInContextMenu: boolean;

  /**
   * Whether the custom command is enabled as a slash command
   */
  slashCommandEnabled: boolean;

  /**
   * Order for display in context menu and settings
   */
  order: number;

  /**
   * Model key to use for the custom command
   */
  modelKey: string;
}
