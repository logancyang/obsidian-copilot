import { App, Platform } from "obsidian";

/**
 * Body class present while Obsidian's mobile bottom navbar element exists.
 * Stylesheet rules key off it (together with `is-hidden-nav`, which Obsidian
 * manages) to reserve navbar space under Copilot views — an explicit class
 * instead of `body:has(.mobile-navbar)`, which the browser would re-evaluate
 * on any DOM mutation, including every streamed chat token.
 */
export const MOBILE_NAVBAR_BODY_CLASS = "copilot-has-mobile-navbar";

/**
 * Keeps {@link MOBILE_NAVBAR_BODY_CLASS} on the body in sync with the presence
 * of a `.mobile-navbar` element. Desktop is a no-op (the navbar is mobile-only
 * chrome, and there is no popout-window ambiguity on mobile). Syncs
 * immediately, again once the workspace layout is ready (the navbar is created
 * during workspace construction), and on every layout-change thereafter, so
 * the class never goes stale where `:has()` was self-updating.
 *
 * @param app - The plugin's App; supplies the workspace events and the document whose body carries the class.
 * @returns Dispose function that unsubscribes and removes the class; hand it to `Plugin.register`.
 */
export function attachMobileNavbarBodyClass(app: App): () => void {
  if (!Platform.isMobile) return () => {};

  const body = app.workspace.containerEl.doc.body;
  const sync = () => {
    body.classList.toggle(MOBILE_NAVBAR_BODY_CLASS, body.querySelector(".mobile-navbar") !== null);
  };

  const layoutChangeRef = app.workspace.on("layout-change", sync);
  app.workspace.onLayoutReady(sync);
  sync();

  return () => {
    app.workspace.offref(layoutChangeRef);
    body.classList.remove(MOBILE_NAVBAR_BODY_CLASS);
  };
}
