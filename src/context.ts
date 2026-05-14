import { App } from "obsidian";
import * as React from "react";

// App context
export const AppContext = React.createContext<App | undefined>(undefined);

// Event target context
export const EventTargetContext = React.createContext<EventTarget | undefined>(undefined);

/**
 * Returns the Obsidian {@link App} provided by the nearest {@link AppContext}.
 *
 * Use this inside React components and hooks instead of touching the global
 * `app` object. Throws if no provider is in scope so callers fail loud rather
 * than silently picking up the wrong window's app in popouts.
 */
export function useApp(): App {
  const app = React.useContext(AppContext);
  if (!app) {
    throw new Error("useApp() called outside of an <AppContext.Provider>");
  }
  return app;
}
