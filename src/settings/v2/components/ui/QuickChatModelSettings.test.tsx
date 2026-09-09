import { QuickChatModelSettings } from "@/settings/v2/components/ui/QuickChatModelSettings";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("QuickChatModelSettings", () => {
  describe("QuickChatModelSettings()", () => {
    it("offers a placeholder until a usable default is selected and forwards model changes", () => {
      const onDefaultModelChange = jest.fn();
      render(
        <QuickChatModelSettings
          defaultModelId={undefined}
          options={[{ label: "Model A", value: "a" }]}
          onDefaultModelChange={onDefaultModelChange}
        >
          <div>Model switches</div>
        </QuickChatModelSettings>
      );
      expect(screen.getByDisplayValue("Select Model")).not.toBeNull();
      expect(screen.getByText("Model switches")).not.toBeNull();
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "Select Model" } });
      expect(onDefaultModelChange).not.toHaveBeenCalled();
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "a" } });
      expect(onDefaultModelChange).toHaveBeenCalledWith("a");
    });
    it("shows the saved default without a placeholder option", () => {
      render(
        <QuickChatModelSettings
          defaultModelId="a"
          options={[{ label: "Model A", value: "a" }]}
          onDefaultModelChange={() => undefined}
        >
          <div>Model switches</div>
        </QuickChatModelSettings>
      );
      expect(screen.getByDisplayValue("Model A")).not.toBeNull();
      expect(screen.queryByText("Select Model")).toBeNull();
    });
  });
});
