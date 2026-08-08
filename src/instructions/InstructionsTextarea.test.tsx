import { InstructionsTextarea } from "@/instructions/InstructionsTextarea";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const EXAMPLES: readonly string[] = Object.freeze(["First example", "Second example"]);

function textarea(): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>("textbox");
}

/** Run frames until `predicate` holds, so a test never depends on the shuffled order. */
function advanceUntil(predicate: () => boolean, budgetMs = 60_000): void {
  for (let elapsed = 0; elapsed < budgetMs && !predicate(); elapsed += 25) {
    act(() => {
      jest.advanceTimersByTime(25);
    });
  }
}

describe("InstructionsTextarea", () => {
  describe("InstructionsTextarea()", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
      Reflect.deleteProperty(window, "matchMedia");
    });

    it("types an example into the placeholder one character at a time", () => {
      render(
        <InstructionsTextarea
          value=""
          onChange={jest.fn()}
          label="Instructions"
          examples={EXAMPLES}
        />
      );

      expect(textarea().placeholder).toBe("");
      act(() => {
        jest.advanceTimersByTime(45 * 5);
      });

      const partial = textarea().placeholder;
      expect(partial.length).toBeGreaterThan(0);
      expect(EXAMPLES.some((example) => example !== partial && example.startsWith(partial))).toBe(
        true
      );
    });

    it("moves on to the other example after holding the first", () => {
      render(
        <InstructionsTextarea
          value=""
          onChange={jest.fn()}
          label="Instructions"
          examples={EXAMPLES}
        />
      );

      advanceUntil(() => EXAMPLES.includes(textarea().placeholder));
      const first = textarea().placeholder;
      advanceUntil(
        () => EXAMPLES.includes(textarea().placeholder) && textarea().placeholder !== first
      );

      expect(textarea().placeholder).toBe(EXAMPLES.find((example) => example !== first));
    });

    it("stops animating while the field has text, since the placeholder is hidden anyway", () => {
      const { rerender } = render(
        <InstructionsTextarea
          value=""
          onChange={jest.fn()}
          label="Instructions"
          examples={EXAMPLES}
        />
      );
      act(() => {
        jest.advanceTimersByTime(45 * 5);
      });
      const frozen = textarea().placeholder;

      rerender(
        <InstructionsTextarea
          value="My rules"
          onChange={jest.fn()}
          label="Instructions"
          examples={EXAMPLES}
        />
      );
      act(() => {
        jest.advanceTimersByTime(45 * 20);
      });

      expect(textarea().placeholder).toBe(frozen);
    });

    it("reports what the user typed", () => {
      const onChange = jest.fn();
      render(
        <InstructionsTextarea
          value=""
          onChange={onChange}
          label="Instructions"
          examples={EXAMPLES}
        />
      );

      fireEvent.change(textarea(), { target: { value: "Cite every source." } });

      expect(onChange).toHaveBeenCalledWith("Cite every source.");
    });

    it("shows a whole example at once for a reader who asked for reduced motion", () => {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({ matches: true }),
      });

      render(
        <InstructionsTextarea
          value=""
          onChange={jest.fn()}
          label="Instructions"
          examples={EXAMPLES}
        />
      );
      act(() => {
        jest.advanceTimersByTime(45);
      });

      expect(EXAMPLES).toContain(textarea().placeholder);
    });
  });
});
