import type { App } from "obsidian";

declare global {
  /**
   * Obsidian provides `app` as an ambient global inside the plugin runtime.
   * Declared here so TypeScript stops flagging it across the codebase.
   */
   
  var app: App;
}

export {};
