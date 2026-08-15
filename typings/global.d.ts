import type { App } from "obsidian";

declare global {
  /**
   * Obsidian provides `app` as an ambient global inside the plugin runtime.
   * Declared here so TypeScript stops flagging it across the codebase.
   */

  var app: App;

  /**
   * Obsidian's DOM creation helpers, declared on `Window` so a specific
   * window's copy can be called explicitly.
   *
   * Obsidian re-evaluates its `globalEnhance()` bootstrap inside every popout
   * window, so each window owns helpers bound to that window's `document`.
   * `obsidian.d.ts` declares them only as ambient globals, which always resolve
   * to the main window; reaching them through a node's own `doc.win` is what
   * keeps a detached element in the document that will host it.
   */
  interface Window {
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      o?: DomElementInfo | string,
      callback?: (el: HTMLElementTagNameMap[K]) => void
    ): HTMLElementTagNameMap[K];
    createDiv(o?: DomElementInfo | string, callback?: (el: HTMLDivElement) => void): HTMLDivElement;
    createSpan(
      o?: DomElementInfo | string,
      callback?: (el: HTMLSpanElement) => void
    ): HTMLSpanElement;
    createFragment(callback?: (el: DocumentFragment) => void): DocumentFragment;
  }
}

export {};
