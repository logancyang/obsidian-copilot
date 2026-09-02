/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- Mock exports must preserve production hook names. */
import { PatternListEditor } from "@/settings/v2/components/PatternListEditor";
import { createPatternSettingsValue, getDecodedPatterns } from "@/search/searchUtils";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/context", () => ({ useApp: () => ({}) }));

jest.mock("@/components/modals/CustomPatternInputModal", () => ({
  CustomPatternInputModal: jest
    .fn()
    .mockImplementation((_app: unknown, onSubmit: (value: string) => void) => ({
      open: () => onSubmit("Archive"),
    })),
}));

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
  if (!("PointerEvent" in window)) {
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
  }
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

describe("PatternListEditor", () => {
  describe("PatternListEditor()", () => {
    it("preserves a hidden property rule when removing a visible rule (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const onChange = jest.fn();
      const value = createPatternSettingsValue({
        tagPatterns: ["#old"],
        propertyPatterns: ["[status:done]"],
      });
      render(<PatternListEditor value={value} onChange={onChange} />);

      fireEvent.click(screen.getByRole("button", { name: "Remove #old" }));

      expect(getDecodedPatterns(onChange.mock.calls[0][0] as string)).toEqual(["[status:done]"]);
    });

    it("preserves a hidden property rule when adding a custom rule (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      const onChange = jest.fn();
      const value = createPatternSettingsValue({
        tagPatterns: ["#old"],
        propertyPatterns: ["[status:done]"],
      });
      render(<PatternListEditor value={value} onChange={onChange} />);

      fireEvent.pointerDown(screen.getByRole("button", { name: "Add..." }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(screen.getByText("Custom"));

      expect(getDecodedPatterns(onChange.mock.calls[0][0] as string)).toEqual([
        "#old",
        "[status:done]",
        "Archive",
      ]);
    });
  });
});
