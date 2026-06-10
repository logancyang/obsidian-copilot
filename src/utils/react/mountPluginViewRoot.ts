import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { App } from "obsidian";
import { ReactNode } from "react";
import { Root } from "react-dom/client";

export interface PluginViewRootHandle {
  /** Re-render the current tree (e.g. after external state changes). */
  rerender(): void;
  /** Unmount the root and detach the popout-migration listener. */
  unmount(): void;
}

/**
 * Mount a React root into an Obsidian ItemView's content element and keep it
 * working when the leaf moves between windows.
 *
 * Reason: when a leaf is dragged to (or back from) an Obsidian popout, its
 * containerEl is reparented into a different window's document but the view's
 * onOpen does not re-fire. Anything bound to the original window — notably the
 * Lexical editor inside ChatInput, whose `_window` stays latched — stops
 * receiving input. Tearing down and recreating the root forces React (and
 * Lexical) to re-register under the new window.
 *
 * `render` is invoked on every (re)mount, so it must return a fresh element
 * tree each call rather than a cached node.
 */
export function mountPluginViewRoot(
  containerEl: HTMLElement,
  app: App,
  render: () => ReactNode
): PluginViewRootHandle {
  let root: Root = createPluginRoot(containerEl.children[1], app);
  root.render(render());

  const detachMigration = containerEl.onWindowMigrated(() => {
    root.unmount();
    root = createPluginRoot(containerEl.children[1], app);
    root.render(render());
  });

  return {
    rerender() {
      root.render(render());
    },
    unmount() {
      detachMigration();
      root.unmount();
    },
  };
}
