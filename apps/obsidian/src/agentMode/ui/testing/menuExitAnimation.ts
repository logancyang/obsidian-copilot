export function simulateMenuExitAnimation(): jest.SpyInstance {
  const realGetComputedStyle = window.getComputedStyle;
  return jest
    .spyOn(window, "getComputedStyle")
    .mockImplementation((element: Element, pseudoElement?: string | null): CSSStyleDeclaration => {
      const style = realGetComputedStyle.call(
        window,
        element,
        pseudoElement
      ) as CSSStyleDeclaration;
      if (element.getAttribute("role") === "menu") {
        Object.defineProperty(style, "animationName", {
          get: () => (element.getAttribute("data-state") === "closed" ? "exit" : "enter"),
        });
      }
      return style;
    });
}
