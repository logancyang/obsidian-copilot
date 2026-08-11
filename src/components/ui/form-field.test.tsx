import { render, screen } from "@testing-library/react";
import React from "react";
import { FormField } from "./form-field";

describe("form-field", () => {
  describe("FormField()", () => {
    it("associates its label, required indication, and identified alert with the caller's input", () => {
      render(
        <FormField
          label="Display name"
          htmlFor="provider-name"
          required
          error
          errorMessage="Choose a different name."
          errorMessageId="provider-name-error"
        >
          <input id="provider-name" aria-describedby="provider-name-error" />
        </FormField>
      );

      const input = screen.getByRole("textbox", { name: "Display name (required)" });
      expect(input.getAttribute("id")).toBe("provider-name");
      expect(input.hasAttribute("required")).toBe(false);
      const alert = screen.getByRole("alert");
      expect(alert.getAttribute("id")).toBe("provider-name-error");
      expect(alert.textContent).toBe("Choose a different name.");
    });
  });
});
