import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ProviderDisplayNameField } from "./ProviderDisplayNameField";

describe("ProviderDisplayNameField", () => {
  describe("ProviderDisplayNameField()", () => {
    it("renders a valid name and reports edits", () => {
      const onChange = jest.fn();
      render(<ProviderDisplayNameField value="OpenRouter 2" onChange={onChange} />);

      const input = screen.getByRole("textbox", { name: /Display name/i });
      expect(input.getAttribute("aria-invalid")).toBe("false");
      expect(input.hasAttribute("required")).toBe(true);
      expect(input.getAttribute("id")).toBeTruthy();
      expect(document.querySelector(`label[for="${input.getAttribute("id")}"]`)).toBeTruthy();
      expect(input.getAttribute("aria-describedby")).toBeNull();
      expect(input.getAttribute("aria-errormessage")).toBeNull();
      fireEvent.change(input, { target: { value: "OpenRouter production" } });
      expect(onChange).toHaveBeenCalledWith("OpenRouter production");
    });

    it("renders the inline uniqueness error and marks the input invalid", () => {
      render(
        <ProviderDisplayNameField
          value="OpenRouter"
          onChange={jest.fn()}
          errorMessage="A provider with this name already exists. Choose a different name."
        />
      );

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/already exists/i);
      const input = screen.getByRole("textbox", { name: /Display name/i });
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe(alert.getAttribute("id"));
      expect(input.getAttribute("aria-errormessage")).toBe(alert.getAttribute("id"));
    });
  });
});
