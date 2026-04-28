import { Platform } from "obsidian";

/**
 * Mobile-keyboard + drawer-hide observers shared by chat views (regular and
 * agent). Pure DOM/lifecycle utilities — no chat-specific state.
 *
 * On mobile, when the soft keyboard opens we want to hide drawer chrome
 * (header/tab options) by toggling a class on the surrounding workspace
 * drawer; and when the drawer is hidden by Obsidian (e.g. user pressed back),
 * any open Radix popover anchored inside this view needs to close so it
 * doesn't jump to (0,0).
 *
 * Returns:
 *  - `dispose`: call from the view's `onClose` to unbind everything.
 *  - `rebindDrawerObserver`: the view can be moved between drawers without
 *    `onOpen` firing again; call this from a `layout-change` handler so the
 *    drawer-hide observer always watches the correct drawer.
 */
export function attachChatViewLayoutObservers(containerEl: HTMLElement): {
  dispose: () => void;
  rebindDrawerObserver: () => void;
} {
  if (!Platform.isMobile) {
    return { dispose: () => {}, rebindDrawerObserver: () => {} };
  }

  let lastDrawerEl: HTMLElement | null = null;
  let drawerHideObserver: MutationObserver | null = null;

  const syncKeyboardClass = () => {
    const drawer = containerEl.closest(".workspace-drawer") as HTMLElement | null;
    if (lastDrawerEl && lastDrawerEl !== drawer) {
      lastDrawerEl.classList.remove("copilot-keyboard-open");
    }
    lastDrawerEl = drawer;
    if (!drawer) return;

    const isCopilotActive = !!containerEl.closest(".workspace-drawer-active-tab-content");
    const kbHeight = parseFloat(
      document.documentElement.style.getPropertyValue("--keyboard-height") || "0"
    );
    drawer.classList.toggle("copilot-keyboard-open", isCopilotActive && kbHeight > 0);
  };

  const keyboardObserver = new MutationObserver(syncKeyboardClass);
  keyboardObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style"],
  });
  syncKeyboardClass();

  const rebindDrawerObserver = () => {
    drawerHideObserver?.disconnect();
    const drawer = containerEl.closest(".workspace-drawer") as HTMLElement | null;
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
    keyboardObserver.disconnect();
    drawerHideObserver?.disconnect();
    lastDrawerEl?.classList.remove("copilot-keyboard-open");
    lastDrawerEl = null;
  };

  return { dispose, rebindDrawerObserver };
}
