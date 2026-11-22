export interface CustomCommand {
  title: string;

  content: string;

  showInContextMenu: boolean;

  showInSlashMenu: boolean;

  order: number;

  modelKey: string;

  lastUsedMs: number;
}
