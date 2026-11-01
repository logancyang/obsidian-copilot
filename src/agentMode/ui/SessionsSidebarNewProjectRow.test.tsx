import { SessionsSidebarNewProjectRow } from "@/agentMode/ui/SessionsSidebarNewProjectRow";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function renderRow(
  overrides: Partial<React.ComponentProps<typeof SessionsSidebarNewProjectRow>> = {}
) {
  const props = {
    name: "",
    saving: false,
    onNameChange: jest.fn(),
    onSubmit: jest.fn(),
    onCancel: jest.fn(),
    ...overrides,
  };
  render(<SessionsSidebarNewProjectRow {...props} />);
  return props;
}

const nameField = () => screen.getByRole("textbox", { name: "Project name" });

describe("SessionsSidebarNewProjectRow", () => {
  describe("SessionsSidebarNewProjectRow()", () => {
    it("shows an empty focused name field ready for typing for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
      renderRow();

      expect((nameField() as HTMLInputElement).value).toBe("");
      expect(document.activeElement).toBe(nameField());
    });

    it("reports each edit of the name", () => {
      const { onNameChange } = renderRow();

      fireEvent.change(nameField(), { target: { value: "Garden" } });

      expect(onNameChange).toHaveBeenCalledWith("Garden");
    });

    it("submits on Enter", () => {
      const { onSubmit } = renderRow({ name: "Garden" });

      fireEvent.keyDown(nameField(), { key: "Enter" });

      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("cancels on Escape without submitting for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
      const { onCancel, onSubmit } = renderRow({ name: "Garden" });

      fireEvent.keyDown(nameField(), { key: "Escape" });

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("cancels when focus leaves an empty name for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
      const { onCancel } = renderRow({ name: "  " });

      fireEvent.blur(nameField());

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("keeps a typed name when focus leaves", () => {
      const { onCancel } = renderRow({ name: "Garden" });

      fireEvent.blur(nameField());

      expect(onCancel).not.toHaveBeenCalled();
    });

    it("shows the creation error under the field and marks the field invalid", () => {
      renderRow({ name: "Garden", error: 'A project with the name "Garden" already exists' });

      expect(screen.getByRole("alert").textContent).toBe(
        'A project with the name "Garden" already exists'
      );
      expect(nameField().getAttribute("aria-invalid")).toBe("true");
    });

    it("ignores Enter and edits while the project is being created", () => {
      const { onSubmit } = renderRow({ name: "Garden", saving: true });

      fireEvent.keyDown(nameField(), { key: "Enter" });

      expect(onSubmit).not.toHaveBeenCalled();
      expect((nameField() as HTMLInputElement).readOnly).toBe(true);
    });
  });
});
