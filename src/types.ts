import { type TFile } from "obsidian";

declare module "obsidian" {
  interface MetadataCache {
    // Note that this API is considered internal and may work differently in the
    // future.
    getBacklinksForFile(file: TFile): {
      data: Map<string, any>;
    } | null;
  }
}
