import type { EditorView } from "@codemirror/view";
import { type TFile } from "obsidian";

declare module "obsidian" {
  interface MetadataCache {
    // Note that this API is considered internal and may work differently in the
    // future.
    getBacklinksForFile(file: TFile): {
      data: Map<string, unknown>;
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

  // Reason: SecretStorage is declared as a class by obsidian@>=1.11.4, but the
  // package pinned in package.json (^1.2.5) ships an older `.d.ts` that lacks
  // it entirely. Declare the full shape here so the project compiles against
  // older obsidian types without bumping the dev dependency (which would also
  // shift @codemirror peers and widen this PR's blast radius). `deleteSecret`
  // is intentionally optional — it exists at runtime since 1.11.4 but remains
  // undocumented, so callers feature-detect it.
  interface SecretStorage {
    setSecret(id: string, secret: string): void;
    getSecret(id: string): string | null;
    listSecrets(): string[];
    deleteSecret?(id: string): void;
  }

  interface App {
    secretStorage?: SecretStorage;
  }
}

export enum PromptSortStrategy {
  TIMESTAMP = "timestamp",
  ALPHABETICAL = "alphabetical",
  MANUAL = "manual",
}

export type ApplyViewResult = "accepted" | "rejected" | "aborted" | "failed";
