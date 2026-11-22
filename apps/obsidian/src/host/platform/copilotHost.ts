import type { App, Component, PluginManifest } from "obsidian";

export interface CopilotHost extends Pick<Component, "register" | "registerEvent"> {
  readonly app: App;
  readonly manifest: PluginManifest;
}
