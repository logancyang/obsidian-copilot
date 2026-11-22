import { Platform } from "obsidian";

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
