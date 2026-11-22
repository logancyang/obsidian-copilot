import type { App, PluginManifest } from "obsidian";

export interface CopilotHost {
  readonly app: App;
  readonly manifest: PluginManifest;
}
