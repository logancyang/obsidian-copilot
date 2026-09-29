import type { EditorView } from "@codemirror/view";
import { type TFile } from "obsidian";

declare module "obsidian" {
  interface MetadataCache {
    getBacklinksForFile(file: TFile): {
      data: Map<string, unknown>;
    } | null;
  }

  interface Editor {
    cm?: EditorView;
  }

  interface MenuItem {
    setSubmenu(): this;

    submenu?: Menu;
  }

  interface SecretStorage {
    setSecret(id: string, secret: string): void;
    getSecret(id: string): string | null;
    listSecrets(): string[];
    deleteSecret?(id: string): void;
  }

  interface App {
    secretStorage?: SecretStorage;

    loadLocalStorage(key: string): unknown;
    saveLocalStorage(key: string, data: unknown): void;
  }
}

export enum PromptSortStrategy {
  TIMESTAMP = "timestamp",
  ALPHABETICAL = "alphabetical",
  MANUAL = "manual",
}

export type ApplyViewResult = "accepted" | "rejected" | "aborted" | "failed";
