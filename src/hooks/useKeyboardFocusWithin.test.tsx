import { useKeyboardFocusWithin } from "@/hooks/useKeyboardFocusWithin";
import { act, render, screen } from "@testing-library/react";
import React from "react";

function FocusProbe(): React.ReactElement {
  const { keyboardFocused, focusWithinProps } = useKeyboardFocusWithin();
  return (
    <>
      <div data-testid="row" data-keyboard-focused={keyboardFocused} {...focusWithinProps}>
        <button type="button">Toggle</button>
        <button type="button">More</button>
      </div>
      <button type="button">Outside</button>
    </>
  );
}

function rowState(): string | null {
  return screen.getByTestId("row").getAttribute("data-keyboard-focused");
}

function focus(name: string, { pointer = false } = {}): void {
  const button = screen.getByRole("button", { name });
  if (pointer) jest.spyOn(button, "matches").mockReturnValue(false);
  act(() => button.focus());
}

describe("useKeyboardFocusWithin", () => {
  describe("useKeyboardFocusWithin()", () => {
    it("reports keyboard focus inside the element and keeps it while focus moves between its descendants for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      render(<FocusProbe />);
      expect(rowState()).toBe("false");

      focus("Toggle");
      expect(rowState()).toBe("true");

      focus("More");
      expect(rowState()).toBe("true");
    });

    it("ignores focus a mouse click leaves inside the element for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      render(<FocusProbe />);

      focus("Toggle", { pointer: true });

      expect(rowState()).toBe("false");
    });

    it("clears once focus leaves the element", () => {
      render(<FocusProbe />);
      focus("Toggle");

      focus("Outside");

      expect(rowState()).toBe("false");
    });
  });
});
