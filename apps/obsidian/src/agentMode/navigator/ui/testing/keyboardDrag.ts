import { act, fireEvent } from "@testing-library/react";

const ROW_HEIGHT = 32;

// jsdom lays nothing out, so dnd-kit would see every row at the same spot; each element is placed one row below its
// previous sibling instead. Call it with Jest fake timers on and restore the returned spy afterward.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/811
export function stackRowsVertically(): jest.SpyInstance {
  return jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    const top = Array.from(this.parentElement?.children ?? []).indexOf(this) * ROW_HEIGHT;
    return {
      top,
      bottom: top + ROW_HEIGHT,
      left: 0,
      right: 200,
      width: 200,
      height: ROW_HEIGHT,
      x: 0,
      y: top,
      toJSON: () => ({}),
    };
  });
}

export function dragByKeyboard(row: HTMLElement, key: "ArrowDown" | "ArrowUp", steps: number) {
  fireEvent.keyDown(row, { code: "Space" });
  act(() => jest.runOnlyPendingTimers());
  for (let step = 0; step < steps; step++) fireEvent.keyDown(row, { code: key });
  fireEvent.keyDown(row, { code: "Space" });
}
