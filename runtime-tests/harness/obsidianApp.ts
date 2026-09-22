import { FileSystemAdapter } from "./obsidianShim";
import * as path from "node:path";

/**
 * The slice of Obsidian's `App` that Agent Mode reads: the vault's name and its
 * filesystem adapter. Passed to `AcpBackendProcess` in place of the real one.
 */
export class App {
  readonly vault: { adapter: FileSystemAdapter; getName: () => string };

  constructor(vaultPath: string) {
    const adapter = new FileSystemAdapter(vaultPath);
    this.vault = { adapter, getName: () => path.basename(vaultPath) };
  }
}
