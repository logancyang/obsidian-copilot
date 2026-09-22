import * as path from "node:path";

import { FileSystemAdapter } from "./obsidianShim";

/** Listener handle returned by the event-emitter stand-ins; nothing fires. */
interface EventRef {
  readonly name: string;
}

/**
 * The slice of Obsidian's `App` that Agent Mode's session layer reads, backed
 * by a real directory. Every member is listed with its reason in
 * `runtime-tests/README.md`.
 */
export class App {
  readonly vault: {
    adapter: FileSystemAdapter;
    getName: () => string;
    getAbstractFileByPath: (path: string) => null;
    on: (name: string) => EventRef;
    offref: (ref: EventRef) => void;
  };
  readonly metadataCache = {
    on: (name: string): EventRef => ({ name }),
    offref: (_ref: EventRef): void => {},
  };
  readonly workspace = {
    getLeavesOfType: (): never[] => [],
  };
  /** Obsidian's keychain bridge, held in memory so no real OS keychain entry is written. */
  readonly secretStorage = new InMemorySecretStorage();

  constructor(vaultPath: string) {
    this.vault = {
      adapter: new FileSystemAdapter(vaultPath),
      getName: () => path.basename(vaultPath),
      // The vault index is empty: the suite never opens notes through Obsidian,
      // and callers fall back to the adapter for files the index does not know.
      getAbstractFileByPath: () => null,
      on: (name: string) => ({ name }),
      offref: () => {},
    };
  }
}

/** Obsidian's `SecretStorage`, backed by a map that dies with the scenario. */
class InMemorySecretStorage {
  readonly #secrets = new Map<string, string>();

  setSecret(id: string, secret: string): void {
    this.#secrets.set(id, secret);
  }

  getSecret(id: string): string | null {
    return this.#secrets.get(id) ?? null;
  }

  listSecrets(): string[] {
    return [...this.#secrets.keys()];
  }

  deleteSecret(id: string): void {
    this.#secrets.delete(id);
  }
}
