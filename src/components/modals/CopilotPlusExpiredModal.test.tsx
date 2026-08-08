import { CopilotPlusExpiredModalContent } from "./CopilotPlusExpiredModal";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const WARNING = /exclusive models will stop working/;

describe("CopilotPlusExpiredModal", () => {
  describe("CopilotPlusExpiredModalContent()", () => {
    it("warns that the models will stop working when a default still points at one", () => {
      render(<CopilotPlusExpiredModalContent onCancel={jest.fn()} isUsingPlusModels />);

      expect(screen.getByText(WARNING)).toBeTruthy();
    });

    it("omits the warning when no default depends on those models", () => {
      render(<CopilotPlusExpiredModalContent onCancel={jest.fn()} isUsingPlusModels={false} />);

      expect(screen.queryByText(WARNING)).toBeNull();
      // The lapsed-license message itself is not conditional.
      expect(screen.getByText(/license key is no longer valid/)).toBeTruthy();
    });

    it("dismisses on Close", () => {
      const onCancel = jest.fn();
      render(<CopilotPlusExpiredModalContent onCancel={onCancel} isUsingPlusModels />);

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });
});
