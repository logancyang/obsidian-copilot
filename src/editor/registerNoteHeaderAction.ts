import { COPILOT_AGENT_ICON_ID } from "@/constants";
import type CopilotPlugin from "@/main";
import { MarkdownView } from "obsidian";

/**
 * Keep the note-to-Agent action on every Markdown header, including views Obsidian opens later.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/579
 */
export function registerNoteHeaderAction(plugin: CopilotPlugin): void {
  const actions = new Map<MarkdownView, HTMLElement>();

  const sync = (): void => {
    if (!plugin.isPluginLifecycleActive()) return;
    const openViews = new Set<MarkdownView>();
    for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof MarkdownView)) continue;
      const view = leaf.view;
      openViews.add(view);
      const existing = actions.get(view);
      // Obsidian may replace a note header when its view changes mode.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/579
      if (existing?.isConnected) continue;
      existing?.remove();

      const action = view.addAction(
        COPILOT_AGENT_ICON_ID,
        "Open Copilot Agent Chat with this note",
        () => {
          // Revealing Agent Chat can move focus, so use the note under this button.
          // An empty Markdown view has no note to attach yet.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/579
          const file = view.file;
          if (file) void plugin.addNoteToAgentChat(file, true);
        }
      );
      actions.set(view, action);
    }

    for (const [view, action] of actions) {
      if (openViews.has(view)) continue;
      action.remove();
      actions.delete(view);
    }
  };

  plugin.app.workspace.onLayoutReady(sync);
  plugin.registerEvent(plugin.app.workspace.on("layout-change", sync));
  plugin.registerEvent(plugin.app.workspace.on("file-open", sync));
  plugin.register(() => {
    for (const action of actions.values()) action.remove();
    actions.clear();
  });
}
