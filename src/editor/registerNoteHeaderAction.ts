import { COPILOT_AGENT_ICON_ID } from "@/constants";
import type CopilotPlugin from "@/main";
import { MarkdownView } from "obsidian";

export function registerNoteHeaderAction(plugin: CopilotPlugin): void {
  const { workspace } = plugin.app;
  const actions = new WeakMap<MarkdownView, HTMLElement>();
  const openViews = (): MarkdownView[] =>
    workspace
      .getLeavesOfType("markdown")
      .flatMap(({ view }) => (view instanceof MarkdownView ? [view] : []));

  const sync = (): void => {
    for (const view of openViews()) {
      if (actions.has(view)) continue;
      const action = view.addAction(
        COPILOT_AGENT_ICON_ID,
        "Open Copilot Agent Chat with this note",
        () => {
          // Revealing Agent Chat can move focus, so use the note under this button.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/579
          const file = view.file;
          if (file) void plugin.addNoteToAgentChat(file, true);
        }
      );
      actions.set(view, action);
    }
  };

  workspace.onLayoutReady(sync);
  plugin.registerEvent(workspace.on("layout-change", sync));
  plugin.register(() => {
    for (const view of openViews()) actions.get(view)?.remove();
  });
}
