import type { App } from "obsidian";

declare global {
  var app: App;

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
