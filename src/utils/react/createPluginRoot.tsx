import { AppContext } from "@/context";
import { App } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";

/**
 * Create a React root that always provides the Obsidian {@link App} via
 * {@link AppContext}.
 *
 * Every standalone React root in the plugin (overlays, modals, item views,
 * setting tabs) must use this helper instead of calling `createRoot`
 * directly so descendants can rely on `useApp()` unconditionally. A static
 * Jest guardrail (`createPluginRoot.test.ts`) enforces this rule.
 *
 * The returned object matches React's {@link Root} interface, so callers
 * can treat it as a drop-in replacement.
 */
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
