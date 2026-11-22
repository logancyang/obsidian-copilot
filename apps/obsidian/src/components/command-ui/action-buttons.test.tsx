import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ActionButtons } from "./action-buttons";

describe("action-buttons", () => {
  describe("ActionButtons()", () => {
    it("offers Run again beside Insert and Replace once a result is ready", () => {
      const onRunAgain = jest.fn();
      render(<ActionButtons state="result" onRunAgain={onRunAgain} />);
      expect(screen.getByText("Insert")).not.toBeNull();
      fireEvent.click(screen.getByText("Run again"));
      expect(onRunAgain).toHaveBeenCalledTimes(1);
    });
    it("offers Run again from the idle state so a failed run can be retried", () => {
      render(<ActionButtons state="idle" onRunAgain={() => undefined} />);
      expect(screen.getByText("Run again")).not.toBeNull();
      expect(screen.queryByText("Insert")).toBeNull();
    });
    it("replaces Run again with Stop while generating", () => {
      render(<ActionButtons state="loading" onRunAgain={() => undefined} />);
      expect(screen.getByText("Stop")).not.toBeNull();
      expect(screen.queryByText("Run again")).toBeNull();
    });
    it("hides Run again when there is no prompt to rerun", () => {
      render(<ActionButtons state="result" />);
      expect(screen.queryByText("Run again")).toBeNull();
    });
  });
});
