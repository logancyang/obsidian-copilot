import type { App } from "obsidian";

interface AppWithPlugins {
  plugins?: { getPlugin(id: string): unknown };
}

interface TemplaterPlugin {
  templater?: { files_with_pending_templates?: unknown };
}

// Templater executes the commands in every new note, and this set of its in-flight writes is the only way to skip one. https://github.com/logancyang/obsidian-copilot/issues/3704
function templaterPendingFiles(app: App): Set<string> | null {
  const plugin = (app as AppWithPlugins).plugins?.getPlugin("templater-obsidian") as
    | TemplaterPlugin
    | null
    | undefined;
  const pending = plugin?.templater?.files_with_pending_templates;
  return pending instanceof Set ? pending : null;
}

export class TemplaterCreateHold {
  private readonly held = new Map<string, Set<string>>();

  hold(app: App, path: string): void {
    const pending = templaterPendingFiles(app);
    if (!pending || pending.has(path)) return;
    pending.add(path);
    this.held.set(path, pending);
  }

  releaseAll(): void {
    for (const [path, pending] of this.held) pending.delete(path);
    this.held.clear();
  }
}
