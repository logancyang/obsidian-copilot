import type { App, EventRef, PluginManifest } from "obsidian";

export interface CopilotHost {
  readonly app: App;
  readonly manifest: PluginManifest;
  register(cleanup: () => void): void;
  registerEvent(eventRef: EventRef): void;
}
