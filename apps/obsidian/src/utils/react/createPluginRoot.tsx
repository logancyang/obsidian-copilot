import { AppContext } from "@/context";
import { App } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";

export function createPluginRoot(container: Element | DocumentFragment, app: App): Root {
  const root = createRoot(container);
  return {
    render(children) {
      root.render(<AppContext.Provider value={app}>{children}</AppContext.Provider>);
    },
    unmount() {
      root.unmount();
    },
  };
}
