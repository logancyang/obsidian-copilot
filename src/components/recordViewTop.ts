export function recordViewTop(viewContentEl: HTMLElement): void {
  viewContentEl.setCssProps({
    "--copilot-view-top": `${viewContentEl.getBoundingClientRect().top}px`,
  });
}
