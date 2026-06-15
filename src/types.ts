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

/**
 * Outcome of an Apply view preview.
 * - `accepted`: the full proposed content was written.
 * - `partial`: the user accepted only some lines, so the file was written but
 *   does NOT match the proposed content.
 * - `rejected`: the user discarded the change; the file is unchanged.
 * - `aborted`: the view closed without a decision (e.g. leaf detached).
 * - `failed`: the write could not be completed.
 */
export type ApplyViewResult = "accepted" | "partial" | "rejected" | "aborted" | "failed";
