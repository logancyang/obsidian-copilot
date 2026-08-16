import { Platform } from "obsidian";

/**
 * Drawer-hide observer shared by chat views (regular and agent). A pure
 * DOM/lifecycle utility — no chat-specific state.
 *
 * When Obsidian hides the drawer on mobile (e.g. the user pressed back), any
 * open Radix popover anchored inside this view has to close, or it re-anchors
 * to a detached element and jumps to (0,0).
 *
 * Returns:
 *  - `dispose`: call from the view's `onClose` to unbind everything.
 *  - `rebindDrawerObserver`: the view can be moved between drawers without
 *    `onOpen` firing again; call this from a `layout-change` handler so the
 *    observer always watches the correct drawer.
 */
export function attachChatViewLayoutObservers(containerEl: HTMLElement): {
  dispose: () => void;
  rebindDrawerObserver: () => void;
} {
  if (!Platform.isMobile) {
    return { dispose: () => {}, rebindDrawerObserver: () => {} };
  }

  let drawerHideObserver: MutationObserver | null = null;

  const rebindDrawerObserver = () => {
    drawerHideObserver?.disconnect();
    const drawer = containerEl.closest(".workspace-drawer");
    if (!drawer) return;

    let wasHidden = drawer.classList.contains("is-hidden");
    drawerHideObserver = new MutationObserver(() => {
      const isHidden = drawer.classList.contains("is-hidden");
      if (isHidden && !wasHidden) {
        containerEl.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
        );
      }
      wasHidden = isHidden;
    });
    drawerHideObserver.observe(drawer, { attributes: true, attributeFilter: ["class"] });
  };
  rebindDrawerObserver();

  const dispose = () => {
    drawerHideObserver?.disconnect();
  };

  return { dispose, rebindDrawerObserver };
}
