import { COPILOT_AGENT_ICON_ID } from "@/constants";
import type { CopilotHost } from "@/host/platform/copilotHost";
import { MarkdownView, type TFile } from "obsidian";

export function registerNoteHeaderAction(
  host: Pick<CopilotHost, "app" | "register" | "registerEvent">,
  addNoteToAgentChat: (note: TFile, openInRightSidebar: boolean) => Promise<void>
): void {
  const { workspace } = host.app;
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
        "Open Copilot Chat with this note",
        () => {
          // Revealing Agent Chat can move focus, so use the note under this button.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/579
          const file = view.file;
          if (file) void addNoteToAgentChat(file, true);
        }
      );
      actions.set(view, action);
    }
  };

  workspace.onLayoutReady(sync);
  host.registerEvent(workspace.on("layout-change", sync));
  host.register(() => {
    for (const view of openViews()) actions.get(view)?.remove();
  });
}
