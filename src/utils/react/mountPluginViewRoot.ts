import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { App } from "obsidian";
import { ReactNode } from "react";
import { Root } from "react-dom/client";

export interface PluginViewRootHandle {
  rerender(): void;
  unmount(): void;
}

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
