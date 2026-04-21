import type { EditorView } from "@codemirror/view";
import { type TFile } from "obsidian";

declare module "obsidian" {
  interface MetadataCache {
    // Note that this API is considered internal and may work differently in the
    // future.
    getBacklinksForFile(file: TFile): {
      data: Map<string, any>;
    } | null;
  }

  interface Editor {
    /**
     * The underlying CodeMirror 6 editor view, when available.
     */
    cm?: EditorView;
  }

  interface MenuItem {
    /**
     * Creates a submenu for this item.
     */
    setSubmenu(): this;

    /**
     * Submenu instance created by `setSubmenu()`, when available.
     */
    submenu?: Menu;
  }

  // Reason: the npm package `obsidian@1.2.5` does not include SecretStorage
  // types. Available since Obsidian 1.11.4.
  interface App {
    /** OS-level secret storage backed by the system keychain. */
    secretStorage?: SecretStorage;
  }

  interface SecretStorage {
    /** Store a secret under the given identifier. */
    setSecret(id: string, secret: string): void;

    /** Retrieve a secret by identifier. Returns `null` if not found. */
    getSecret(id: string): string | null;

    /** List all stored secret identifiers. */
    listSecrets(): string[];

    // Reason: deleteSecret exists at runtime but is not in the official type
    // definitions (as of 1.11.4). Declared here so callers can feature-detect.
    deleteSecret?(id: string): void;
  }
}

export enum PromptSortStrategy {
  TIMESTAMP = "timestamp",
  ALPHABETICAL = "alphabetical",
  MANUAL = "manual",
}

export type ApplyViewResult = "accepted" | "rejected" | "aborted" | "failed";
